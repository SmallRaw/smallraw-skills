#!/usr/bin/env bash
# usage-fetch.sh — Fetch Anthropic Usage API data, write cache.
# Triggered by statusline.sh in background.
set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
LOCK_FILE="$HOME/.claude/hud-usage-fetch.lock"
CACHE_FILE="$HOME/.claude/hud-usage-cache.json"
LAST_FETCH_FILE="$HOME/.claude/hud-usage-last-fetch"
CONFIG_FILE="$HOME/.claude/hud-config.json"
CREDS_FILE="$HOME/.claude/.credentials.json"

mkdir -p "$HOME/.claude"

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

# ── Read credentials ──────────────────────────────────────────────────────────
access_token=""
subscription_type=""
expires_at=""

# macOS Keychain (primary)
keychain_data=$(/usr/bin/security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [[ -n "$keychain_data" ]]; then
  parsed_token=$(echo "$keychain_data" | jq -r '.claudeAiOauth.accessToken // ""' 2>/dev/null || true)
  parsed_sub=$(echo "$keychain_data" | jq -r '.claudeAiOauth.subscriptionType // ""' 2>/dev/null || true)
  parsed_exp=$(echo "$keychain_data" | jq -r '.claudeAiOauth.expiresAt // ""' 2>/dev/null || true)

  if [[ -n "$parsed_token" ]]; then
    # Check expiry
    now_ms=$(( $(date +%s) * 1000 ))
    if [[ -z "$parsed_exp" || "$parsed_exp" == "null" || "$parsed_exp" -gt "$now_ms" ]]; then
      access_token="$parsed_token"
      subscription_type="$parsed_sub"
      expires_at="$parsed_exp"
    fi
  fi
fi

# File fallback
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

# ── API call ──────────────────────────────────────────────────────────────────
now_ts=$(date +%s)

response=$(curl -s --max-time 15 \
  -H "Authorization: Bearer $access_token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "User-Agent: claude-code/2.1" \
  "https://api.anthropic.com/api/oauth/usage" 2>/dev/null || true)

# ── Parse and write cache ─────────────────────────────────────────────────────
if [[ -z "$response" ]]; then
  printf '{"error":"network","fetchedAt":%s}\n' "$now_ts" > "${CACHE_FILE}.tmp"
  mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  date +%s > "$LAST_FETCH_FILE"
  exit 0
fi

# Check for API error or non-JSON response
if ! echo "$response" | jq -e . >/dev/null 2>&1; then
  printf '{"error":"network","fetchedAt":%s}\n' "$now_ts" > "${CACHE_FILE}.tmp"
  mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  date +%s > "$LAST_FETCH_FILE"
  exit 0
fi

# Check for error field in response
api_error=$(echo "$response" | jq -r '.error // ""' 2>/dev/null || true)
if [[ -n "$api_error" && "$api_error" != "null" ]]; then
  printf '{"error":"network","fetchedAt":%s}\n' "$now_ts" > "${CACHE_FILE}.tmp"
  mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
  date +%s > "$LAST_FETCH_FILE"
  exit 0
fi

# Parse usage — API response format:
# { "five_hour": { "utilization": 25, "resets_at": "..." }, "seven_day": { "utilization": 60, "resets_at": "..." } }
echo "$response" | jq --arg plan "$plan_name" --argjson now "$now_ts" '
{
  planName: $plan,
  fiveHour: ((.five_hour.utilization // null) | if . then ([0, .] | max | [., 100] | min | round) else null end),
  sevenDay: ((.seven_day.utilization // null) | if . then ([0, .] | max | [., 100] | min | round) else null end),
  fiveHourResetAt: (.five_hour.resets_at // null),
  sevenDayResetAt: (.seven_day.resets_at // null),
  fetchedAt: $now
}' > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"

# ── Write timestamp ───────────────────────────────────────────────────────────
date +%s > "$LAST_FETCH_FILE"
