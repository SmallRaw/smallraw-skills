#!/usr/bin/env bash
# scan-transcript.sh — Parse a Claude Code transcript JSONL and write the HUD session cache.
# Usage: scan-transcript.sh <transcript.jsonl> [session_id]
# Output: $CLAUDE_HUD_DIR/sessions/<session_id>.json (default ~/.claude/hud/sessions/).
# Never writes into the project directory the session runs in.
# Reference: jarrodwatts/claude-hud transcript.ts
set -euo pipefail

TRANSCRIPT="${1:-}"
SESSION_ID="${2:-}"

# ── Validate inputs ───────────────────────────────────────────────────────────
if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  exit 0
fi

# Session ID defaults to the transcript filename ({session_id}.jsonl)
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID=$(basename "$TRANSCRIPT" .jsonl)
fi
# Session IDs are UUID-like; refuse anything that could escape the cache dir
if [[ ! "$SESSION_ID" =~ ^[0-9A-Za-z_-]+$ ]]; then
  exit 0
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
HUD_DIR="${CLAUDE_HUD_DIR:-$HOME/.claude/hud}"
SESS_DIR="$HUD_DIR/sessions"
CACHE_FILE="$SESS_DIR/$SESSION_ID.json"
LOCK_FILE="$SESS_DIR/$SESSION_ID.lock"
SCAN_TS_FILE="$SESS_DIR/$SESSION_ID.scan-ts"

mkdir -p "$SESS_DIR"

# ── Skip when the transcript has not changed since the last scan ─────────────
transcript_mtime=$(stat -f %m "$TRANSCRIPT" 2>/dev/null || echo 0)
last_scan=$(cat "$SCAN_TS_FILE" 2>/dev/null || echo 0)
[[ "$last_scan" =~ ^[0-9]+$ ]] || last_scan=0
if [[ -f "$CACHE_FILE" && "$transcript_mtime" -le "$last_scan" ]]; then
  date +%s > "$SCAN_TS_FILE"
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

# Create lock. The scan timestamp is written on EVERY exit, including a failed
# parse, so a transient error can never turn into a retry on every refresh.
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"; date +%s > "$SCAN_TS_FILE"' EXIT

# ── Parse transcript with jq ──────────────────────────────────────────────────
# The transcript is appended while we read it, so the last line is often
# truncated. `fromjson?` drops unparsable lines instead of failing the scan.
# Notes:
#   1. Filter content to arrays only (some entries have string content)
#   2. Agent tool name is "Agent" (not "Task")
#   3. Also skip "Agent" from tool list
jq -R 'fromjson? // empty' "$TRANSCRIPT" | jq -s '
  # ── Flatten content blocks, skip non-array content ─────────────────────────
  [
    .[] |
    . as $line |
    ($line.timestamp // null) as $ts |
    (if ($line.message.content | type) == "array" then $line.message.content else [] end)[] |
    . + { _ts: $ts }
  ] as $blocks |

  # ── Separate tool_use and tool_result ───────────────────────────────────────
  ($blocks | map(select(.type == "tool_use")))   as $uses   |
  ($blocks | map(select(.type == "tool_result"))) as $results |

  # ── Build completion map: tool_use_id → { is_error, timestamp } ─────────────
  (
    $results |
    map({ key: .tool_use_id, value: { is_error: (.is_error // false), endTime: ._ts } }) |
    from_entries
  ) as $done |

  # ── Session start ─────────────────────────────────────────────────────────
  ($blocks | map(._ts) | map(select(. != null)) | first) as $sessionStart |

  # ── Skills (deduplicated, in call order) ─────────────────────────────────
  (
    $uses |
    map(select(.name == "Skill")) |
    map(.input.skill // empty) |
    map(select(. != "")) |
    reduce .[] as $s ([]; if (. | index($s)) then . else . + [$s] end)
  ) as $skills |

  # ── Names to exclude from tool list ────────────────────────────────────────
  (["Agent","Task","TodoWrite","TaskCreate","TaskUpdate","Skill"]) as $skip |

  # ── Tools ────────────────────────────────────────────────────────────────
  (
    $uses |
    map(select(.name as $n | $skip | index($n) | not)) |
    map(
      ($done[.id] // null) as $completion |
      {
        id: .id,
        name: .name,
        target: (
          if   (.name == "Read"  or .name == "Write" or .name == "Edit")
          then (.input.file_path // null)
          elif (.name == "Glob"  or .name == "Grep")
          then (.input.pattern   // null)
          elif (.name == "Bash")
          then ((.input.command // "") | .[0:30])
          else null
          end
        ),
        status: (if $completion then (if $completion.is_error then "error" else "completed" end) else "running" end),
        startTime: ._ts
      }
    ) |
    .[-20:]
  ) as $tools |

  # ── Agents (tool name "Agent" in transcript, legacy "Task") ─────────────
  (
    $uses |
    map(select(.name == "Agent" or .name == "Task")) |
    map(
      ($done[.id] // null) as $completion |
      {
        id: .id,
        type: (.input.subagent_type // null),
        model: (.input.model // null),
        description: (.input.description // null),
        status: (if $completion then (if $completion.is_error then "error" else "completed" end) else "running" end),
        startTime: ._ts,
        endTime: (if $completion then $completion.endTime else null end)
      }
    ) |
    .[-10:]
  ) as $agents |

  # ── Status normalizer ────────────────────────────────────────────────────
  def normalize_status:
    if . == "not_started" then "pending"
    elif . == "running"    then "in_progress"
    elif . == "done"       then "completed"
    elif . == "complete"   then "completed"
    else .
    end;

  # ── Todos: process in order ───────────────────────────────────────────────
  (
    $uses |
    map(select(.name == "TodoWrite" or .name == "TaskCreate" or .name == "TaskUpdate")) |
    reduce .[] as $op (
      [];  # initial todo list
      if $op.name == "TodoWrite" then
        # Replace entire list
        ($op.input.todos // []) |
        map({ content: .content, status: (.status | normalize_status) })
      elif $op.name == "TaskCreate" then
        # Append new task
        . + [{
          content: (($op.input.subject // $op.input.description) // ""),
          status: (($op.input.status // "pending") | normalize_status)
        }]
      elif $op.name == "TaskUpdate" then
        # Update by taskId (1-based numeric index)
        ($op.input.taskId | tostring | tonumber? // null) as $idx |
        if $idx then
          [
            to_entries[] |
            if .key == ($idx - 1) then
              .value * (
                (if $op.input.status then { status: ($op.input.status | normalize_status) } else {} end) +
                (if $op.input.subject then { content: $op.input.subject } else {} end)
              )
            else
              .value
            end
          ]
        else
          .
        end
      else
        .
      end
    )
  ) as $todos |

  # ── Output ────────────────────────────────────────────────────────────────
  {
    tools: $tools,
    agents: $agents,
    todos: $todos,
    skills: $skills,
    sessionStart: $sessionStart,
    updatedAt: now
  }
' > "${CACHE_FILE}.tmp" || { rm -f "${CACHE_FILE}.tmp"; exit 1; }

# Atomic replace: statusline.sh only ever sees a complete file.
mv "${CACHE_FILE}.tmp" "$CACHE_FILE"

# ── Prune session state untouched for 2 days ─────────────────────────────────
find "$SESS_DIR" -type f -mtime +2 -delete 2>/dev/null || true
