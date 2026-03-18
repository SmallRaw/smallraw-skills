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
  @sh "cost=\(.cost.total_cost_usd // "")"
')"

# Effort level from settings (not in statusline JSON)
effort=$(jq -r '.effortLevel // ""' "$HOME/.claude/settings.json" 2>/dev/null)

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[36m'
PURPLE='\033[35m'
WHITE='\033[97m'
DIM='\033[2m'
RED='\033[31m'
YELLOW='\033[33m'
GREEN='\033[32m'
RESET='\033[0m'

# ── Directory: ~/.../last-segment ────────────────────────────────────────────
home="$HOME"
short_dir="${cwd/#$home/\~}"
seg_count=$(echo "$short_dir" | tr '/' '\n' | wc -l | tr -d ' ')
if [ "$seg_count" -gt 3 ]; then
  last=$(basename "$short_dir")
  short_dir="~/.../${last}"
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
