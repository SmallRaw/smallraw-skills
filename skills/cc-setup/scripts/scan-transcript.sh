#!/usr/bin/env bash
# scan-transcript.sh — Parse a Claude Code transcript JSONL and write HUD cache.
# Usage: scan-transcript.sh <transcript.jsonl> <project-dir>
# Reference: jarrodwatts/claude-hud transcript.ts
set -euo pipefail

TRANSCRIPT="${1:-}"
PROJECT_DIR="${2:-}"

# ── Validate inputs ───────────────────────────────────────────────────────────
if [[ -z "$TRANSCRIPT" || -z "$PROJECT_DIR" ]]; then
  exit 0
fi

if [[ ! -f "$TRANSCRIPT" ]]; then
  exit 0
fi

# ── Session ID from transcript filename ({session_id}.jsonl) ─────────────────
SESSION_ID=$(basename "$TRANSCRIPT" .jsonl)

# ── Paths ─────────────────────────────────────────────────────────────────────
CACHE_DIR="${PROJECT_DIR}/.claude"
CACHE_FILE="${CACHE_DIR}/hud-cache.json"
LOCK_FILE="${CACHE_DIR}/hud-scan.lock"
SCAN_TS_FILE="${CACHE_DIR}/hud-last-scan"

mkdir -p "$CACHE_DIR"

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

# Create lock and register cleanup
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Parse transcript with jq ──────────────────────────────────────────────────
# Key fixes vs old version:
#   1. Filter content to arrays only (some entries have string content)
#   2. Agent tool name is "Agent" (not "Task")
#   3. Also skip "Agent" from tool list
jq -s '
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

  # ── Session ID (from first entry) ──────────────────────────────────────────
  ([.[] | .sessionId // empty] | first // null) as $sessionId |

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
' "$TRANSCRIPT" > "${CACHE_FILE}.session.tmp" || { rm -f "${CACHE_FILE}.session.tmp"; exit 1; }

# ── Merge into cache file under session key, prune entries older than 2 days ─
SESSION_DATA=$(cat "${CACHE_FILE}.session.tmp")
rm -f "${CACHE_FILE}.session.tmp"

EXISTING="{}"
if [ -f "$CACHE_FILE" ]; then
  # Only keep existing if it's a keyed object (not old flat format)
  is_keyed=$(jq -r 'if type == "object" and (keys | all(test("^[0-9a-f-]+$"))) then "yes" else "no" end' "$CACHE_FILE" 2>/dev/null || echo "no")
  [ "$is_keyed" = "yes" ] && EXISTING=$(cat "$CACHE_FILE")
fi

echo "$EXISTING" | jq --arg sid "$SESSION_ID" --argjson data "$SESSION_DATA" \
  '(.[$sid] = $data) | with_entries(select(.value.updatedAt > (now - 172800)))' \
  > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"

# ── Write timestamp ───────────────────────────────────────────────────────────
date +%s > "$SCAN_TS_FILE"
