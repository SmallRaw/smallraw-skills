#!/usr/bin/env bash
# scan-transcript.sh — Parse a Claude Code transcript JSONL and write HUD cache.
# Usage: scan-transcript.sh <transcript.jsonl> <project-dir>
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
jq -s '
  # ── Flatten all content blocks, carrying timestamp ──────────────────────────
  [
    .[] |
    . as $line |
    ($line.timestamp // null) as $ts |
    ($line.message.content // [])[] |
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

  # ── Agent names to exclude from tool list ────────────────────────────────
  (["Task","TodoWrite","TaskCreate","TaskUpdate"]) as $skip |

  # ── Tools ────────────────────────────────────────────────────────────────
  (
    $uses |
    map(select(.name as $n | $skip | index($n) | not)) |
    map(
      . as $u |
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

  # ── Agents ───────────────────────────────────────────────────────────────
  (
    $uses |
    map(select(.name == "Task")) |
    map(
      . as $u |
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
        . + [{ content: ($op.input.subject // ""), status: "pending" }]
      elif $op.name == "TaskUpdate" then
        # Update by taskId (1-based numeric index)
        ($op.input.taskId | tonumber? // null) as $idx |
        if $idx then
          [
            to_entries[] |
            if .key == ($idx - 1) then
              .value * {
                status: (($op.input.status // .value.status) | normalize_status)
              }
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
    sessionStart: $sessionStart
  }
' "$TRANSCRIPT" > "${CACHE_FILE}.tmp" && mv "${CACHE_FILE}.tmp" "$CACHE_FILE"

# ── Write timestamp ───────────────────────────────────────────────────────────
date +%s > "$SCAN_TS_FILE"
