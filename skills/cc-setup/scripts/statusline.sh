#!/usr/bin/env bash
# Single-line statusline:
# ~/.../dir | branch +ins -del | Model | ctx 87% [==========--] 160/200k | $0.47

input=$(cat)

# ── Parse JSON (single jq call) ─────────────────────────────────────────────
eval "$(echo "$input" | jq -r '
  @sh "cwd=\(.workspace.current_dir // .cwd // "")",
  @sh "model=\(.model.display_name // "")",
  @sh "remaining_pct=\(.context_window.remaining_percentage // "")",
  @sh "used_pct=\(.context_window.used_percentage // "")",
  @sh "ctx_size=\(.context_window.context_window_size // "")",
  @sh "input_tokens=\(.context_window.current_usage.input_tokens // "")",
  @sh "cost=\(.cost.total_cost_usd // "")",
  @sh "transcript_path=\(.transcript_path // "")"
')"

# Effort level from settings (not in statusline JSON)
effort=$(jq -r '.effortLevel // ""' "$HOME/.claude/settings.json" 2>/dev/null)

# ── Config ──────────────────────────────────────────────────────────────────
HUD_CONFIG="$HOME/.claude/hud-config.json"
cfg_showTools="false"
cfg_showAgents="false"
cfg_showTodos="false"
cfg_showUsage="false"
cfg_showDuration="false"
cfg_transcriptRefresh=5
cfg_usageRefresh=3600
cfg_pathLevels=1

if [ -f "$HUD_CONFIG" ]; then
  eval "$(jq -r '
    @sh "cfg_showTools=\(.display.showTools // false)",
    @sh "cfg_showAgents=\(.display.showAgents // false)",
    @sh "cfg_showTodos=\(.display.showTodos // false)",
    @sh "cfg_showUsage=\(.display.showUsage // false)",
    @sh "cfg_showDuration=\(.display.showDuration // false)",
    @sh "cfg_transcriptRefresh=\(.refresh.transcriptRefreshSeconds // 5)",
    @sh "cfg_usageRefresh=\(.refresh.usageRefreshSeconds // 3600)",
    @sh "cfg_pathLevels=\(.pathLevels // 1)"
  ' "$HUD_CONFIG" 2>/dev/null)" || true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[36m'
PURPLE='\033[35m'
WHITE='\033[97m'
DIM='\033[2m'
RED='\033[31m'
YELLOW='\033[33m'
GREEN='\033[32m'
RESET='\033[0m'

# ── Directory: pathLevels-based truncation ─────────────────────────────────
home="$HOME"
if [ -n "$cwd" ]; then
  IFS='/' read -ra _segs <<< "$cwd"
  if [ "${#_segs[@]}" -gt "$cfg_pathLevels" ]; then
    short_dir=$(printf '%s/' "${_segs[@]: -$cfg_pathLevels}" | sed 's|/$||')
  else
    short_dir="${cwd/#$home/\~}"
  fi
else
  short_dir="?"
fi

parts=()
parts+=("${CYAN}${short_dir}${RESET}")

# ── Git: branch +ins -del ────────────────────────────────────────────────────
if git_branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null); then
  [ ${#git_branch} -gt 20 ] && git_branch="${git_branch:0:20}..."

  diff_stat=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" diff HEAD --numstat 2>/dev/null | awk '
    { ins += $1; del += $2 } END { printf "%d %d", ins, del }
  ')
  ins=$(echo "$diff_stat" | cut -d' ' -f1)
  del=$(echo "$diff_stat" | cut -d' ' -f2)

  git_part="${PURPLE}${git_branch}${RESET}"
  [ "$ins" -gt 0 ] && git_part+=" ${GREEN}+${ins}${RESET}"
  [ "$del" -gt 0 ] && git_part+=" ${RED}-${del}${RESET}"

  parts+=("${git_part}")
fi

# ── Model · effort ────────────────────────────────────────────────────────────
if [ -n "$model" ]; then
  model_part="${WHITE}${model}${RESET}"
  [ -n "$effort" ] && model_part+=" ${DIM}·${RESET} ${DIM}${effort}${RESET}"
  parts+=("${model_part}")
fi

# ── Context: ctx 87% [==========--] 160/200k ────────────────────────────────
if [ -n "$used_pct" ] && [ -n "$remaining_pct" ]; then
  used_int=$(printf "%.0f" "$used_pct")
  remaining_int=$(printf "%.0f" "$remaining_pct")

  if   [ "$used_int" -gt 80 ]; then CTX_COLOR="$RED"
  elif [ "$used_int" -gt 60 ]; then CTX_COLOR="$YELLOW"
  else                               CTX_COLOR="$GREEN"
  fi

  bar_width=10
  filled=$(( used_int * bar_width / 100 ))
  [ "$filled" -gt "$bar_width" ] && filled=$bar_width
  empty=$(( bar_width - filled ))

  bar=""
  for ((i=0; i<filled; i++)); do bar+="="; done
  for ((i=0; i<empty;  i++)); do bar+="-"; done

  ctx_part="${CTX_COLOR}ctx ${used_int}%${RESET} [${CTX_COLOR}${bar}${RESET}]"

  if [ -n "$ctx_size" ] && [ "$ctx_size" != "null" ]; then
    # Derive used tokens from percentage (includes cache + output tokens)
    used_tokens=$(awk "BEGIN { printf \"%.0f\", $used_int * $ctx_size / 100 }")
    if [ "$used_tokens" -lt 1000 ]; then
      used_fmt="${used_tokens}"
    else
      used_fmt="$(awk "BEGIN { printf \"%.0f\", $used_tokens / 1000 }")k"
    fi
    total_k=$(awk "BEGIN { printf \"%.0f\", $ctx_size / 1000 }")
    ctx_part+=" ${DIM}${used_fmt}/${total_k}k${RESET}"
  fi

  # Append cost with · if available
  if [ -n "$cost" ] && [ "$cost" != "null" ] && [ "$cost" != "" ]; then
    cost_fmt=$(awk "BEGIN { printf \"%.2f\", $cost }")
    ctx_part+=" ${DIM}· \$${cost_fmt}${RESET}"
  fi

  parts+=("${ctx_part}")
fi

# ── Output: join with | ─────────────────────────────────────────────────────
sep=" ${DIM}|${RESET} "
out=""
for ((i=0; i<${#parts[@]}; i++)); do
  [ $i -gt 0 ] && out+="$sep"
  out+="${parts[$i]}"
done

printf '%b\n' "$out"

# ── Extra lines ─────────────────────────────────────────────────────────────
HUD_CACHE="${cwd:+$cwd/.claude/hud-cache.json}"

# ── Tools line ──────────────────────────────────────────────────────────────
if [ "$cfg_showTools" = "true" ] && [ -n "$HUD_CACHE" ] && [ -f "$HUD_CACHE" ]; then
  tools_line=$(jq -r '
    (.tools // []) |
    if length == 0 then empty else
      ([ .[] | select(.status == "running") ] | .[-2:]) as $running |
      ([ .[] | select(.status == "completed" or .status == "error") ]
       | group_by(.name) | map({name: .[0].name, count: length})
       | sort_by(-.count) | .[:4]
      ) as $completed |
      [
        ($running[] |
          "\u001b[33m◐\u001b[0m \u001b[36m\(.name)\u001b[0m" +
          (if .target then "\u001b[2m: \(.target[:20])\u001b[0m" else "" end)
        ),
        ($completed[] |
          "\u001b[32m✓\u001b[0m \(.name) \u001b[2m×\(.count)\u001b[0m"
        )
      ] | if length == 0 then empty else join(" \u001b[2m|\u001b[0m ") end
    end
  ' "$HUD_CACHE" 2>/dev/null) || true
  [ -n "$tools_line" ] && printf '%b\n' "$tools_line"
fi

# ── Agents line ─────────────────────────────────────────────────────────────
if [ "$cfg_showAgents" = "true" ] && [ -n "$HUD_CACHE" ] && [ -f "$HUD_CACHE" ]; then
  now_epoch=$(date +%s)
  agents_line=$(jq -r --argjson now "$now_epoch" '
    def to_epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
    def fmt_elapsed(secs):
      if secs < 60 then "\(secs)s"
      elif secs < 3600 then "\(secs / 60 | floor)m \(secs % 60)s"
      else "\(secs / 3600 | floor)h \((secs % 3600) / 60 | floor)m"
      end;

    (.agents // []) |
    if length == 0 then empty else
      ([ .[] | select(.status == "running") ]) as $running |
      ([ .[] | select(.status == "completed") ] | .[-2:]) as $recent |
      ($running + $recent) | .[-3:] | .[] |
      (if .status == "running" then "\u001b[33m◐\u001b[0m"
       else "\u001b[32m✓\u001b[0m" end) as $icon |
      (if .endTime and .endTime != null then
        ((.endTime | to_epoch) - (.startTime | to_epoch))
       else ($now - (.startTime | to_epoch)) end | floor) as $secs |
      "\($icon) \u001b[35m\(.type // "?")\u001b[0m" +
      (if .model then " \u001b[2m[\(.model)]\u001b[0m" else "" end) +
      (if .description then "\u001b[2m: \(.description[:40])\u001b[0m" else "" end) +
      " \u001b[2m(\(fmt_elapsed($secs)))\u001b[0m"
    end
  ' "$HUD_CACHE" 2>/dev/null) || true
  if [ -n "$agents_line" ]; then
    while IFS= read -r line; do
      printf '%b\n' "$line"
    done <<< "$agents_line"
  fi
fi

# ── Todos line ──────────────────────────────────────────────────────────────
if [ "$cfg_showTodos" = "true" ] && [ -n "$HUD_CACHE" ] && [ -f "$HUD_CACHE" ]; then
  todos_line=$(jq -r '
    (.todos // []) |
    if length == 0 then empty else
      ([ .[] | select(.status == "completed") ] | length) as $done |
      length as $total |
      ([ .[] | select(.status == "in_progress") ] | first // null) as $current |
      if $current then
        "\u001b[33m▸\u001b[0m \($current.content[:50]) \u001b[2m(\($done)/\($total))\u001b[0m"
      elif $done == $total and $total > 0 then
        "\u001b[32m✓\u001b[0m All todos complete \u001b[2m(\($done)/\($total))\u001b[0m"
      else empty end
    end
  ' "$HUD_CACHE" 2>/dev/null) || true
  [ -n "$todos_line" ] && printf '%b\n' "$todos_line"
fi

# ── Usage line ──────────────────────────────────────────────────────────────
USAGE_CACHE="$HOME/.claude/hud-usage-cache.json"
if [ "$cfg_showUsage" = "true" ] && [ -f "$USAGE_CACHE" ]; then
  usage_line=$(jq -r '
    if .error then empty
    elif .fiveHour == null then empty
    else
      (.planName // "Plan") as $name |
      (.fiveHour // 0) as $pct |

      # Color based on percent
      (if $pct >= 100 then "\u001b[31m"
       elif $pct >= 80 then "\u001b[35m"
       else "\u001b[34m" end) as $color |

      # Progress bar (10 chars)
      (($pct * 10 / 100) | floor | if . > 10 then 10 elif . < 0 then 0 else . end) as $filled |
      (10 - $filled) as $empty |
      ([range($filled)] | map("█") | join("")) as $bar_filled |
      ([range($empty)] | map("░") | join("")) as $bar_empty |

      # Time remaining from fiveHourResetAt
      (if .fiveHourResetAt then
        ((.fiveHourResetAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - now | floor) |
        if . <= 0 then ""
        elif . < 3600 then " (\(. / 60 | floor)m left)"
        else " (\(. / 3600 | floor)h \((. % 3600) / 60 | floor)m left)"
        end
       else "" end) as $time_left |

      $color + $name + "\u001b[0m " +
      $color + $bar_filled + "\u001b[0m\u001b[2m" + $bar_empty + "\u001b[0m" +
      " " + $color + "\($pct)%\u001b[0m" +
      "\u001b[2m" + $time_left + "\u001b[0m"
    end
  ' "$USAGE_CACHE" 2>/dev/null) || true
  [ -n "$usage_line" ] && printf '%b\n' "$usage_line"
fi

# ── Trigger background scans (after all output) ────────────────────────────
now_ts=$(date +%s)

# Transcript scan
if [ "$cfg_showTools" = "true" ] || [ "$cfg_showAgents" = "true" ] || [ "$cfg_showTodos" = "true" ]; then
  if [ -n "$transcript_path" ] && [ -n "$cwd" ]; then
    last_scan=0
    [ -f "$cwd/.claude/hud-last-scan" ] && last_scan=$(cat "$cwd/.claude/hud-last-scan" 2>/dev/null || echo 0)
    if [ $(( now_ts - last_scan )) -ge "$cfg_transcriptRefresh" ]; then
      "$SCRIPT_DIR/scan-transcript.sh" "$transcript_path" "$cwd" &>/dev/null & disown
    fi
  fi
fi

# Usage fetch
if [ "$cfg_showUsage" = "true" ]; then
  last_fetch=0
  [ -f "$HOME/.claude/hud-usage-last-fetch" ] && last_fetch=$(cat "$HOME/.claude/hud-usage-last-fetch" 2>/dev/null || echo 0)
  if [ $(( now_ts - last_fetch )) -ge "$cfg_usageRefresh" ]; then
    "$SCRIPT_DIR/usage-fetch.sh" &>/dev/null & disown
  fi
fi
