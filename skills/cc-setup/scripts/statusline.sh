#!/usr/bin/env bash
# HUD statusline for Claude Code
# Features: path, git, model, context (with autocompact + token breakdown),
#           session duration, config counts, tools, agents, todos, usage

input=$(cat)

# ── Parse JSON (single jq call) ─────────────────────────────────────────────
eval "$(echo "$input" | jq -r '
  @sh "cwd=\(.workspace.current_dir // .cwd // "")",
  @sh "model=\(.model.display_name // "")",
  @sh "remaining_pct=\(.context_window.remaining_percentage // "")",
  @sh "used_pct=\(.context_window.used_percentage // "")",
  @sh "ctx_size=\(.context_window.context_window_size // "")",
  @sh "input_tokens=\(.context_window.current_usage.input_tokens // "")",
  @sh "output_tokens=\(.context_window.current_usage.output_tokens // "")",
  @sh "cache_create=\(.context_window.current_usage.cache_creation_input_tokens // "")",
  @sh "cache_read=\(.context_window.current_usage.cache_read_input_tokens // "")",
  @sh "cost=\(.cost.total_cost_usd // "")",
  @sh "transcript_path=\(.transcript_path // "")",
  @sh "session_id=\(.session_id // "")"
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
cfg_showConfigCounts="false"
cfg_showSkills="false"
cfg_transcriptRefresh=1
cfg_usageRefresh=1800
cfg_pathLevels=1

if [ -f "$HUD_CONFIG" ]; then
  eval "$(jq -r '
    @sh "cfg_showTools=\(.display.showTools // false)",
    @sh "cfg_showAgents=\(.display.showAgents // false)",
    @sh "cfg_showTodos=\(.display.showTodos // false)",
    @sh "cfg_showUsage=\(.display.showUsage // false)",
    @sh "cfg_showDuration=\(.display.showDuration // false)",
    @sh "cfg_showConfigCounts=\(.display.showConfigCounts // false)",
    @sh "cfg_showSkills=\(.display.showSkills // false)",
    @sh "cfg_transcriptRefresh=\(.refresh.transcriptRefreshSeconds // 5)",
    @sh "cfg_usageRefresh=\(.refresh.usageRefreshSeconds // 1800)",
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
    short_dir="…/$(printf '%s/' "${_segs[@]: -$cfg_pathLevels}" | sed 's|/$||')"
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
  model="${model%% (*}"
  model_part="${WHITE}${model}${RESET}"
  [ -n "$effort" ] && model_part+=" ${DIM}·${RESET} ${DIM}${effort}${RESET}"
  parts+=("${model_part}")
fi

# ── Context: % + bar + token breakdown ───────────────────────────────────────
ctx_part=""
if [ -n "$used_pct" ] && [ -n "$remaining_pct" ]; then
  raw_used_int=$(printf "%.0f" "$used_pct")
  used_int=$raw_used_int

  if   [ "$used_int" -gt 80 ]; then CTX_COLOR="$RED"
  elif [ "$used_int" -gt 60 ]; then CTX_COLOR="$YELLOW"
  else                               CTX_COLOR="$GREEN"
  fi

  bar_width=10
  filled=$(( used_int * bar_width / 100 ))
  [ "$filled" -gt "$bar_width" ] && filled=$bar_width
  empty=$(( bar_width - filled ))

  bar_filled=""
  bar_empty=""
  for ((i=0; i<filled; i++)); do bar_filled+="█"; done
  for ((i=0; i<empty;  i++)); do bar_empty+="░"; done

  ctx_part="${CTX_COLOR}${bar_filled}${RESET}${DIM}${bar_empty}${RESET} ${CTX_COLOR}${used_int}%${RESET}"

  if [ -n "$ctx_size" ] && [ "$ctx_size" != "null" ]; then
    used_tokens=$(awk "BEGIN { printf \"%.0f\", $raw_used_int * $ctx_size / 100 }")
    if [ "$used_tokens" -ge 1000000 ]; then
      used_fmt=$(awk "BEGIN { printf \"%.1fM\", $used_tokens / 1000000 }")
    elif [ "$used_tokens" -ge 1000 ]; then
      used_fmt="$(( used_tokens / 1000 ))k"
    else
      used_fmt="$used_tokens"
    fi
    if [ "$ctx_size" -ge 1000000 ]; then
      total_fmt=$(awk "BEGIN { printf \"%.0fM\", $ctx_size / 1000000 }")
    else
      total_fmt="$(( ctx_size / 1000 ))k"
    fi
    ctx_part+=" ${DIM}${used_fmt}/${total_fmt}${RESET}"
  fi

  # Token breakdown at high context (≥85%)
  if [ "$used_int" -ge 85 ]; then
    in_fmt=""
    cache_fmt=""
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ]; then
      if [ "$input_tokens" -ge 1000000 ] 2>/dev/null; then
        in_fmt=$(awk "BEGIN { printf \"%.1fM\", $input_tokens / 1000000 }")
      elif [ "$input_tokens" -ge 1000 ] 2>/dev/null; then
        in_fmt="$(( input_tokens / 1000 ))k"
      else
        in_fmt="$input_tokens"
      fi
    fi
    cache_total=0
    [ -n "$cache_create" ] && [ "$cache_create" != "null" ] && cache_total=$(( cache_total + cache_create ))
    [ -n "$cache_read" ] && [ "$cache_read" != "null" ] && cache_total=$(( cache_total + cache_read ))
    if [ "$cache_total" -ge 1000000 ] 2>/dev/null; then
      cache_fmt=$(awk "BEGIN { printf \"%.1fM\", $cache_total / 1000000 }")
    elif [ "$cache_total" -ge 1000 ] 2>/dev/null; then
      cache_fmt="$(( cache_total / 1000 ))k"
    elif [ "$cache_total" -gt 0 ]; then
      cache_fmt="$cache_total"
    fi
    if [ -n "$in_fmt" ] && [ -n "$cache_fmt" ]; then
      ctx_part+=" ${DIM}in:${in_fmt} cache:${cache_fmt}${RESET}"
    elif [ -n "$in_fmt" ]; then
      ctx_part+=" ${DIM}in:${in_fmt}${RESET}"
    fi
  fi

  # ctx_part built but NOT added to line 1 — combined with usage on line 2
fi

# ── Extract current session data from hud-cache ─────────────────────────────
HUD_CACHE="${cwd:+$cwd/.claude/hud-cache.json}"
HUD_SESSION=""
if [ -n "$HUD_CACHE" ] && [ -f "$HUD_CACHE" ] && [ -n "$session_id" ]; then
  HUD_SESSION=$(jq -c --arg sid "$session_id" '.[$sid] // empty' "$HUD_CACHE" 2>/dev/null || true)
fi

# ── Session duration ─────────────────────────────────────────────────────────
if [ "$cfg_showDuration" = "true" ] && [ -n "$HUD_SESSION" ]; then
  session_start=$(echo "$HUD_SESSION" | jq -r '.sessionStart // empty' 2>/dev/null || true)
  if [ -n "$session_start" ]; then
    start_epoch=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${session_start%%.*}" +%s 2>/dev/null || true)
    if [ -n "$start_epoch" ]; then
      now_epoch=$(date +%s)
      elapsed=$(( now_epoch - start_epoch ))
      if [ "$elapsed" -ge 3600 ]; then
        dur_fmt="$(( elapsed / 3600 ))h $(( (elapsed % 3600) / 60 ))m"
      elif [ "$elapsed" -ge 60 ]; then
        dur_fmt="$(( elapsed / 60 ))m"
      else
        dur_fmt="<1m"
      fi
      parts+=("${DIM}${dur_fmt}${RESET}")
    fi
  fi
fi

# ── Config counts ────────────────────────────────────────────────────────────
if [ "$cfg_showConfigCounts" = "true" ] && [ -n "$cwd" ]; then
  claude_md_count=0
  rules_count=0
  mcp_count=0
  hooks_count=0

  # Count CLAUDE.md files (project + home)
  [ -f "$cwd/CLAUDE.md" ] && claude_md_count=$(( claude_md_count + 1 ))
  [ -f "$HOME/.claude/CLAUDE.md" ] && claude_md_count=$(( claude_md_count + 1 ))
  # Count .claude/rules/*.md
  if [ -d "$cwd/.claude/rules" ]; then
    rules_count=$(find "$cwd/.claude/rules" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ -d "$HOME/.claude/rules" ]; then
    rules_count=$(( rules_count + $(find "$HOME/.claude/rules" -name '*.md' 2>/dev/null | wc -l | tr -d ' ') ))
  fi
  # Count MCP servers from settings
  if [ -f "$cwd/.claude/settings.local.json" ]; then
    mc=$(jq '.mcpServers | length // 0' "$cwd/.claude/settings.local.json" 2>/dev/null || echo 0)
    mcp_count=$(( mcp_count + mc ))
  fi
  if [ -f "$HOME/.claude/settings.json" ]; then
    mc=$(jq '.mcpServers | length // 0' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
    mcp_count=$(( mcp_count + mc ))
  fi
  # Count hooks
  if [ -f "$HOME/.claude/settings.json" ]; then
    hc=$(jq '[.hooks // {} | to_entries[] | .value | length] | add // 0' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
    hooks_count=$(( hooks_count + hc ))
  fi

  cfg_parts=""
  [ "$claude_md_count" -gt 0 ] && cfg_parts+="${claude_md_count}CLAUDE.md "
  [ "$rules_count" -gt 0 ] && cfg_parts+="${rules_count}rules "
  [ "$mcp_count" -gt 0 ] && cfg_parts+="${mcp_count}MCP "
  [ "$hooks_count" -gt 0 ] && cfg_parts+="${hooks_count}hooks "
  cfg_parts=$(echo "$cfg_parts" | sed 's/ $//')
  [ -n "$cfg_parts" ] && parts+=("${DIM}${cfg_parts}${RESET}")
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

# ── Skills line ───────────────────────────────────────────────────────────────
if [ "$cfg_showSkills" = "true" ] && [ -n "$HUD_SESSION" ]; then
  skills_line=$(echo "$HUD_SESSION" | jq -r '
    if (.skills // []) | length == 0 then empty
    else
      (.skills | map("\u001b[33m⚡\u001b[0m\u001b[36m\(.)\u001b[0m") | join(" \u001b[2m|\u001b[0m "))
    end
  ' 2>/dev/null) || true
  [ -n "$skills_line" ] && printf '%b\n' "$skills_line"
fi

# ── Tools line ──────────────────────────────────────────────────────────────
if [ "$cfg_showTools" = "true" ] && [ -n "$HUD_SESSION" ]; then
  tools_line=$(echo "$HUD_SESSION" | jq -r '
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
  ' 2>/dev/null) || true
  [ -n "$tools_line" ] && printf '%b\n' "$tools_line"
fi

# ── Agents line ─────────────────────────────────────────────────────────────
if [ "$cfg_showAgents" = "true" ] && [ -n "$HUD_SESSION" ]; then
  now_epoch=$(date +%s)
  agents_line=$(echo "$HUD_SESSION" | jq -r --argjson now "$now_epoch" '
    def to_epoch: sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601;
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
      (if .status == "completed" and .endTime != null then
        ($now - (.endTime | to_epoch) | floor) |
        if . < 60 then "just now"
        elif . < 3600 then "\(. / 60 | floor)m ago"
        else "\(. / 3600 | floor)h ago"
        end
       else null end) as $ago |
      "\($icon) \u001b[35m\(.type // "?")\u001b[0m" +
      (if .model then " \u001b[2m[\(.model)]\u001b[0m" else "" end) +
      (if .description then "\u001b[2m: \(.description[:40])\u001b[0m" else "" end) +
      " \u001b[2m(\(fmt_elapsed($secs)))\u001b[0m" +
      (if $ago then " \u001b[2m\($ago)\u001b[0m" else "" end)
    end
  ' 2>/dev/null) || true
  if [ -n "$agents_line" ]; then
    while IFS= read -r line; do
      printf '%b\n' "$line"
    done <<< "$agents_line"
  fi
fi

# ── Todos line ──────────────────────────────────────────────────────────────
if [ "$cfg_showTodos" = "true" ] && [ -n "$HUD_SESSION" ]; then
  todos_line=$(echo "$HUD_SESSION" | jq -r '
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
  ' 2>/dev/null) || true
  [ -n "$todos_line" ] && printf '%b\n' "$todos_line"
fi

# ── Usage line ──────────────────────────────────────────────────────────────
USAGE_CACHE="$HOME/.claude/hud-usage-cache.json"
usage_line=""
if [ "$cfg_showUsage" = "true" ] && [ -f "$USAGE_CACHE" ]; then
  usage_line=$(jq -r '
    # Helper: build bar + pct + time for a single window
    def render_bar(pct; reset_at; window_name):
      (if pct >= 100 then "\u001b[31m"
       elif pct >= 80 then "\u001b[35m"
       else "\u001b[34m" end) as $c |
      ((pct * 10 / 100) | floor | if . > 10 then 10 elif . < 0 then 0 else . end) as $f |
      (10 - $f) as $e |
      ([range($f)] | map("█") | join("")) as $bf |
      ([range($e)] | map("░") | join("")) as $be |
      (if reset_at then
        ((reset_at | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601) - now | floor) |
        if . <= 0 then ""
        else
          (if . < 3600 then "\(. / 60 | floor)m"
           elif . < 86400 then "\(. / 3600 | floor)h\((. % 3600) / 60 | floor)m"
           else "\(. / 86400 | floor)d \((. % 86400) / 3600 | floor)h"
           end) as $dur |
          if pct >= 100 then " resets \($dur)"
          else " \($dur)/\(window_name)"
          end
        end
       else "" end) as $t |
      $c + $bf + "\u001b[0m\u001b[2m" + $be + "\u001b[0m " + $c + "\(pct)%\u001b[0m" +
      (if $t != "" then "\u001b[2m" + $t + "\u001b[0m" else "" end);

    # When rate-limited, fall back to lastGoodData if available
    (if .error == "rate-limited" and .lastGoodData then .lastGoodData
     elif .error then null
     else . end) as $src |

    if $src == null then empty
    elif ($src.fiveHour // null) == null then empty
    else
      ($src.planName // .planName // "Plan") as $name |
      ($src.fiveHour // 0) as $p5 | ($src.fiveHourResetAt // null) as $r5 |
      ($src.sevenDay // null) as $p7 | ($src.sevenDayResetAt // null) as $r7 |
      (if .error == "rate-limited" then " \u001b[33m↻\u001b[0m" else "" end) as $sync |

      # Check for limit reached
      (if $p5 >= 100 or ($p7 != null and $p7 >= 100) then true else false end) as $limit |

      if $limit then
        # Limit reached — special display
        (if $p5 >= 100 then $r5 else $r7 end) as $reset_at |
        (if $reset_at then
          ((($reset_at | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601) - now | floor) |
           if . <= 0 then "" elif . < 3600 then " (resets \(. / 60 | floor)m)"
           else " (resets \(. / 3600 | floor)h\((. % 3600) / 60 | floor)m)" end)
         else "" end) as $reset_str |
        "\u001b[31m⚠ Limit reached\($reset_str)\u001b[0m" + $sync
      else
        # Normal display
        (null | render_bar($p5; $r5; "5h")) as $bar5 |
        (if $p7 != null then (null | render_bar($p7; $r7; "7d")) else null end) as $bar7 |
        $bar5 +
        (if $bar7 != null then " \u001b[2m|\u001b[0m " + $bar7 else "" end) +
        $sync
      end
    end
  ' "$USAGE_CACHE" 2>/dev/null) || true

fi
# Combine ctx + usage on one line
line2_sep=" ${DIM}|${RESET} "
line2=""
[ -n "$ctx_part" ] && line2="$ctx_part"
if [ -n "$usage_line" ]; then
  [ -n "$line2" ] && line2+="$line2_sep"
  line2+="$usage_line"
fi
[ -n "$line2" ] && printf '%b\n' "$line2"

# ── Trigger background scans (after all output) ────────────────────────────
now_ts=$(date +%s)

# Transcript scan (also needed for skills line)
if [ -n "$transcript_path" ] && [ -n "$cwd" ] && [ -n "$session_id" ]; then
  last_scan=0
  scan_ts_file="$cwd/.claude/hud-last-scan"
  [ -f "$scan_ts_file" ] && last_scan=$(cat "$scan_ts_file" 2>/dev/null || echo 0)
  if [ $(( now_ts - last_scan )) -ge "$cfg_transcriptRefresh" ]; then
    /bin/bash "$SCRIPT_DIR/scan-transcript.sh" "$transcript_path" "$cwd" &>/dev/null & disown
  fi
fi

# Usage fetch
if [ "$cfg_showUsage" = "true" ]; then
  last_fetch=0
  [ -f "$HOME/.claude/hud-usage-last-fetch" ] && last_fetch=$(cat "$HOME/.claude/hud-usage-last-fetch" 2>/dev/null || echo 0)
  if [ $(( now_ts - last_fetch )) -ge "$cfg_usageRefresh" ]; then
    /bin/bash "$SCRIPT_DIR/usage-fetch.sh" &>/dev/null & disown
  fi
fi

