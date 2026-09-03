#!/usr/bin/env bash
# usage-fetch.sh — Fetch Anthropic Usage API data, write cache.
# Triggered by statusline.sh in background.
# Reference: jarrodwatts/claude-hud usage-api.ts
set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
# All HUD state lives under $CLAUDE_HUD_DIR (default ~/.claude/hud); only the
# user-edited config stays at ~/.claude/hud-config.json.
HUD_DIR="${CLAUDE_HUD_DIR:-$HOME/.claude/hud}"
CACHE_FILE="$HUD_DIR/usage-cache.json"
LAST_FETCH_FILE="$HUD_DIR/usage-last-fetch"
LOCK_FILE="$HUD_DIR/usage-fetch.lock"
CONFIG_FILE="$HOME/.claude/hud-config.json"
KEYCHAIN_BACKOFF_FILE="$HUD_DIR/keychain-backoff"

# Claude config dir (respect CLAUDE_CONFIG_DIR env var)
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CREDS_FILE="$CLAUDE_CONFIG_DIR/.credentials.json"
LEGACY_SERVICE="Claude Code-credentials"

mkdir -p "$HUD_DIR"

# ── Skip if custom API endpoint ──────────────────────────────────────────────
base_url="${ANTHROPIC_BASE_URL:-${ANTHROPIC_API_BASE_URL:-}}"
if [[ -n "$base_url" ]]; then
  # Check if it's NOT the default Anthropic API
  if [[ "$base_url" != "https://api.anthropic.com"* ]]; then
    exit 0
  fi
fi

# ── Active hours check ────────────────────────────────────────────────────────
if [[ -f "$CONFIG_FILE" ]]; then
  hour_start=$(jq -r '.refresh.usageActiveHoursUTC8[0] // 9' "$CONFIG_FILE" 2>/dev/null || echo 9)
  hour_end=$(jq -r '.refresh.usageActiveHoursUTC8[1] // 23' "$CONFIG_FILE" 2>/dev/null || echo 23)
else
  hour_start=9
  hour_end=23
fi

current_hour=$(TZ=Asia/Shanghai date +%H | sed 's/^0//')
if [[ "$current_hour" -lt "$hour_start" || "$current_hour" -ge "$hour_end" ]]; then
  exit 0
fi

# ── Concurrency control ───────────────────────────────────────────────────────
if [[ -f "$LOCK_FILE" ]]; then
  lock_mtime=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$(( now - lock_mtime ))
  if [[ "$age" -lt 30 ]]; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Keychain service name resolution ─────────────────────────────────────────
# Claude Code uses hashed suffix for non-default config dirs (matches claude-hud logic)
resolve_service_names() {
  local config_dir="$1"
  local default_dir="$HOME/.claude"
  local names=()

  # Normalize paths
  local norm_config
  norm_config=$(cd "$config_dir" 2>/dev/null && pwd || echo "$config_dir")
  local norm_default
  norm_default=$(cd "$default_dir" 2>/dev/null && pwd || echo "$default_dir")

  if [[ "$norm_config" == "$norm_default" ]]; then
    names+=("$LEGACY_SERVICE")
  else
    local hash
    hash=$(printf '%s' "$norm_config" | shasum -a 256 | cut -c1-8)
    names+=("${LEGACY_SERVICE}-${hash}")
    names+=("$LEGACY_SERVICE")  # fallback
  fi

  # If CLAUDE_CONFIG_DIR env is set, also try its hashed variant
  if [[ -n "${CLAUDE_CONFIG_DIR:-}" && "$CLAUDE_CONFIG_DIR" != "$default_dir" ]]; then
    local env_hash
    env_hash=$(printf '%s' "$CLAUDE_CONFIG_DIR" | shasum -a 256 | cut -c1-8)
    names+=("${LEGACY_SERVICE}-${env_hash}")
  fi

  # Deduplicate
  printf '%s\n' "${names[@]}" | awk '!seen[$0]++'
}

# ── Keychain backoff check ───────────────────────────────────────────────────
is_keychain_backoff() {
  if [[ ! -f "$KEYCHAIN_BACKOFF_FILE" ]]; then
    return 1
  fi
  local ts
  ts=$(cat "$KEYCHAIN_BACKOFF_FILE" 2>/dev/null || echo 0)
  local now_s
  now_s=$(date +%s)
  if (( now_s - ts < 60 )); then
    return 0  # in backoff
  fi
  return 1
}

record_keychain_failure() {
  date +%s > "$KEYCHAIN_BACKOFF_FILE" 2>/dev/null || true
}

# ── Read credentials ──────────────────────────────────────────────────────────
access_token=""
subscription_type=""

# macOS Keychain (primary) — try with account name first, then without
if [[ "$(uname)" == "Darwin" ]] && ! is_keychain_backoff; then
  account_name=$(id -un 2>/dev/null || true)
  service_names=$(resolve_service_names "$CLAUDE_CONFIG_DIR")
  keychain_ok=false

  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue

    # Try with account name first (Claude Code 2.x stores with -a)
    if [[ -n "$account_name" ]]; then
      keychain_data=$(/usr/bin/security find-generic-password -s "$svc" -a "$account_name" -w 2>/dev/null || true)
      if [[ -n "$keychain_data" ]]; then
        parsed_token=$(echo "$keychain_data" | jq -r '.claudeAiOauth.accessToken // ""' 2>/dev/null || true)
        parsed_sub=$(echo "$keychain_data" | jq -r '.claudeAiOauth.subscriptionType // ""' 2>/dev/null || true)
        parsed_exp=$(echo "$keychain_data" | jq -r '.claudeAiOauth.expiresAt // ""' 2>/dev/null || true)

        if [[ -n "$parsed_token" ]]; then
          now_ms=$(( $(date +%s) * 1000 ))
          if [[ -z "$parsed_exp" || "$parsed_exp" == "null" || "$parsed_exp" -gt "$now_ms" ]]; then
            access_token="$parsed_token"
            subscription_type="$parsed_sub"
            keychain_ok=true
            break
          fi
        fi
      fi
    fi

    # Fallback: without account name
    keychain_data=$(/usr/bin/security find-generic-password -s "$svc" -w 2>/dev/null || true)
    if [[ -n "$keychain_data" ]]; then
      parsed_token=$(echo "$keychain_data" | jq -r '.claudeAiOauth.accessToken // ""' 2>/dev/null || true)
      parsed_sub=$(echo "$keychain_data" | jq -r '.claudeAiOauth.subscriptionType // ""' 2>/dev/null || true)
      parsed_exp=$(echo "$keychain_data" | jq -r '.claudeAiOauth.expiresAt // ""' 2>/dev/null || true)

      if [[ -n "$parsed_token" ]]; then
        now_ms=$(( $(date +%s) * 1000 ))
        if [[ -z "$parsed_exp" || "$parsed_exp" == "null" || "$parsed_exp" -gt "$now_ms" ]]; then
          access_token="$parsed_token"
          subscription_type="$parsed_sub"
          keychain_ok=true
          break
        fi
      fi
    fi
  done <<< "$service_names"

  # If keychain failed entirely (not just missing), record for backoff
  if ! $keychain_ok && [[ -z "$access_token" ]]; then
    record_keychain_failure
  fi
fi

# File fallback — also supplement subscriptionType if keychain had none
if [[ -z "$access_token" && -f "$CREDS_FILE" ]]; then
  parsed_token=$(jq -r '.claudeAiOauth.accessToken // ""' "$CREDS_FILE" 2>/dev/null || true)
  parsed_sub=$(jq -r '.claudeAiOauth.subscriptionType // ""' "$CREDS_FILE" 2>/dev/null || true)
  parsed_exp=$(jq -r '.claudeAiOauth.expiresAt // ""' "$CREDS_FILE" 2>/dev/null || true)

  if [[ -n "$parsed_token" ]]; then
    now_ms=$(( $(date +%s) * 1000 ))
    if [[ -z "$parsed_exp" || "$parsed_exp" == "null" || "$parsed_exp" -gt "$now_ms" ]]; then
      access_token="$parsed_token"
      subscription_type="$parsed_sub"
    fi
  fi
elif [[ -n "$access_token" && -z "$subscription_type" && -f "$CREDS_FILE" ]]; then
  # Keychain had token but no subscriptionType — supplement from file
  file_sub=$(jq -r '.claudeAiOauth.subscriptionType // ""' "$CREDS_FILE" 2>/dev/null || true)
  [[ -n "$file_sub" ]] && subscription_type="$file_sub"
fi

# No valid credentials found
if [[ -z "$access_token" ]]; then
  exit 0
fi

# ── Plan name determination ───────────────────────────────────────────────────
sub_lower=$(echo "$subscription_type" | tr '[:upper:]' '[:lower:]')

if [[ -z "$sub_lower" || "$sub_lower" == *"api"* ]]; then
  exit 0
elif [[ "$sub_lower" == *"max"* ]]; then
  plan_name="Max"
elif [[ "$sub_lower" == *"pro"* ]]; then
  plan_name="Pro"
elif [[ "$sub_lower" == *"team"* ]]; then
  plan_name="Team"
else
  exit 0
fi

# ── API call (capture HTTP status separately) ────────────────────────────────
now_ts=$(date +%s)
http_code=""
response=""

# Use -w to get HTTP status code, -D for headers
tmp_headers=$(mktemp)
trap 'rm -f "$LOCK_FILE" "$tmp_headers"' EXIT

http_output=$(curl -s --max-time 15 -w '\n%{http_code}' \
  -D "$tmp_headers" \
  -H "Authorization: Bearer $access_token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "User-Agent: claude-code/2.1" \
  "https://api.anthropic.com/api/oauth/usage" 2>/dev/null || true)

if [[ -n "$http_output" ]]; then
  http_code=$(echo "$http_output" | tail -1)
  response=$(echo "$http_output" | sed '$d')
fi

# ── Handle 429 rate limiting ─────────────────────────────────────────────────
write_error_cache() {
  local error_type="$1"
  # Preserve lastGoodData from existing cache if available
  local last_good=""
  if [[ -f "$CACHE_FILE" ]]; then
    last_good=$(jq -c '.lastGoodData // empty' "$CACHE_FILE" 2>/dev/null || true)
  fi

  if [[ -n "$last_good" && "$last_good" != "null" ]]; then
    jq -n --arg err "$error_type" --argjson now "$now_ts" --argjson lg "$last_good" \
      '{ error: $err, fetchedAt: $now, lastGoodData: $lg }' \
      > "${CACHE_FILE}.tmp"
  else
    jq -n --arg err "$error_type" --argjson now "$now_ts" \
      '{ error: $err, fetchedAt: $now }' \
      > "${CACHE_FILE}.tmp"
  fi
  mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  date +%s > "$LAST_FETCH_FILE"
}

if [[ "$http_code" == "429" ]]; then
  # Parse Retry-After header
  retry_after=$(grep -i '^retry-after:' "$tmp_headers" 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | tr -d '\r' || true)
  # Read existing rate limit count for exponential backoff
  prev_count=$(jq -r '.rateLimitedCount // 0' "$CACHE_FILE" 2>/dev/null || echo 0)
  new_count=$(( prev_count + 1 ))

  # Preserve lastGoodData
  last_good=""
  if [[ -f "$CACHE_FILE" ]]; then
    last_good=$(jq -c '.lastGoodData // empty' "$CACHE_FILE" 2>/dev/null || true)
  fi

  if [[ -n "$last_good" && "$last_good" != "null" ]]; then
    jq -n --arg plan "$plan_name" --argjson now "$now_ts" \
      --argjson count "$new_count" --argjson lg "$last_good" \
      --arg retry "$retry_after" \
      '{
        error: "rate-limited",
        planName: $plan,
        rateLimitedCount: $count,
        retryAfterSec: (if $retry != "" then ($retry | tonumber? // null) else null end),
        lastGoodData: $lg,
        fetchedAt: $now
      }' > "${CACHE_FILE}.tmp"
  else
    jq -n --arg plan "$plan_name" --argjson now "$now_ts" \
      --argjson count "$new_count" --arg retry "$retry_after" \
      '{
        error: "rate-limited",
        planName: $plan,
        rateLimitedCount: $count,
        retryAfterSec: (if $retry != "" then ($retry | tonumber? // null) else null end),
        fetchedAt: $now
      }' > "${CACHE_FILE}.tmp"
  fi
  mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  date +%s > "$LAST_FETCH_FILE"
  exit 0
fi

# ── Handle other errors ──────────────────────────────────────────────────────
if [[ -z "$response" ]]; then
  write_error_cache "network"
  exit 0
fi

if ! echo "$response" | jq -e . >/dev/null 2>&1; then
  write_error_cache "parse"
  exit 0
fi

if [[ "$http_code" != "200" && -n "$http_code" ]]; then
  write_error_cache "http-${http_code}"
  exit 0
fi

api_error=$(echo "$response" | jq -r '.error // ""' 2>/dev/null || true)
if [[ -n "$api_error" && "$api_error" != "null" ]]; then
  write_error_cache "api"
  exit 0
fi

# ── Parse and write cache ─────────────────────────────────────────────────────
# Success — store data and also as lastGoodData for rate-limit resilience
echo "$response" | jq --arg plan "$plan_name" --argjson now "$now_ts" '
{
  planName: $plan,
  fiveHour: ((.five_hour.utilization // null) | if . and isnormal then ([0, .] | max | [., 100] | min | round) else null end),
  sevenDay: ((.seven_day.utilization // null) | if . and isnormal then ([0, .] | max | [., 100] | min | round) else null end),
  fiveHourResetAt: (.five_hour.resets_at // null),
  sevenDayResetAt: (.seven_day.resets_at // null),
  rateLimitedCount: 0,
  fetchedAt: $now,
  lastGoodData: {
    planName: $plan,
    fiveHour: ((.five_hour.utilization // null) | if . and isnormal then ([0, .] | max | [., 100] | min | round) else null end),
    sevenDay: ((.seven_day.utilization // null) | if . and isnormal then ([0, .] | max | [., 100] | min | round) else null end),
    fiveHourResetAt: (.five_hour.resets_at // null),
    sevenDayResetAt: (.seven_day.resets_at // null)
  }
}' > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"

# ── Write timestamp ───────────────────────────────────────────────────────────
date +%s > "$LAST_FETCH_FILE"
