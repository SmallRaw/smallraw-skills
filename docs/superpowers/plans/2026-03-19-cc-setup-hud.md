# cc-setup HUD 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 claude-hud 的工具活动、Agent 追踪、Todo 进度、Usage 限额能力移植到 cc-setup 的 bash statusline 中。

**Architecture:** 读写分离 — statusline.sh 只读缓存文件渲染，scan-transcript.sh 和 usage-fetch.sh 作为一次性后台脚本写缓存。项目状态存 `<project>/.claude/`，全局状态存 `~/.claude/`。

**Tech Stack:** Bash, jq, curl, macOS Keychain (`/usr/bin/security`)

**Spec:** `docs/superpowers/specs/2026-03-19-cc-setup-hud-design.md`

---

## 文件清单

```
skills/cc-setup/scripts/
  scan-transcript.sh      ← 新增：解析 transcript JSONL，写 hud-cache.json
  usage-fetch.sh           ← 新增：调 Anthropic Usage API，写 hud-usage-cache.json
  statusline.sh            ← 修改：读配置 + 读缓存 + 渲染新段 + 触发后台脚本
skills/cc-setup/
  SKILL.md                 ← 修改：新增 HUD 子选项文档
```

---

### Task 1: scan-transcript.sh — transcript JSONL 解析

**Files:**
- Create: `skills/cc-setup/scripts/scan-transcript.sh`

这是整个 HUD 的数据核心。读 transcript JSONL，提取 tools/agents/todos，输出 `hud-cache.json`。

- [ ] **Step 1: 创建脚本骨架**

```bash
#!/usr/bin/env bash
# scan-transcript.sh — 解析 Claude Code transcript JSONL，提取工具/Agent/Todo 数据
# 用法: scan-transcript.sh <transcript_path> <project_dir>
# 由 statusline.sh 后台触发，一次性执行后退出

set -euo pipefail

TRANSCRIPT="$1"
PROJECT_DIR="$2"
CACHE_DIR="$PROJECT_DIR/.claude"
CACHE_FILE="$CACHE_DIR/hud-cache.json"
LOCK_FILE="$CACHE_DIR/hud-scan.lock"
LOCK_STALE_SECONDS=30

# ── Lock ────────────────────────────────────────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$lock_age" -lt "$LOCK_STALE_SECONDS" ]; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Validate ────────────────────────────────────────────────────────────────
if [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

mkdir -p "$CACHE_DIR"

# ── Parse JSONL with jq ────────────────────────────────────────────────────
jq -s '
# Flatten all content blocks with timestamps
[ .[] | .timestamp as $ts |
  (.message.content // [])[] |
  . + { timestamp: $ts }
] |

# Separate tool_use and tool_result
([ .[] | select(.type == "tool_use") ]) as $uses |
([ .[] | select(.type == "tool_result") ]) as $results |

# Build completion map: tool_use_id -> { is_error, timestamp }
( $results | map({ (.tool_use_id): { is_error, timestamp } }) | add // {} ) as $completions |

# Session start = first timestamp
( [ $uses[].timestamp, $results[].timestamp ] | sort | first // null ) as $sessionStart |

# ── Tools: not Task/TodoWrite/TaskCreate/TaskUpdate ──
( $uses
  | [ .[] | select(
      .name != "Task" and
      .name != "TodoWrite" and
      .name != "TaskCreate" and
      .name != "TaskUpdate"
    ) |
    {
      id,
      name,
      target: (
        if .name == "Read" or .name == "Write" or .name == "Edit" then
          (.input.file_path // .input.path // null)
        elif .name == "Glob" or .name == "Grep" then
          (.input.pattern // null)
        elif .name == "Bash" then
          ((.input.command // "")[0:30])
        else null end
      ),
      status: (if $completions[.id] then
        (if $completions[.id].is_error then "error" else "completed" end)
      else "running" end),
      startTime: .timestamp
    }
  ]
  | .[-20:]
) as $tools |

# ── Agents: name == "Task" ──
( $uses
  | [ .[] | select(.name == "Task") |
    {
      id,
      type: (.input.subagent_type // "unknown"),
      model: (.input.model // null),
      description: (.input.description // null),
      status: (if $completions[.id] then "completed" else "running" end),
      startTime: .timestamp,
      endTime: ($completions[.id].timestamp // null)
    }
  ]
  | .[-10:]
) as $agents |

# ── Todos: TodoWrite replaces all, TaskCreate appends, TaskUpdate modifies ──
( reduce ($uses[] | select(
    .name == "TodoWrite" or .name == "TaskCreate" or .name == "TaskUpdate"
  )) as $entry (
    [];
    if $entry.name == "TodoWrite" then
      [ ($entry.input.todos // [])[] | { content, status } ]
    elif $entry.name == "TaskCreate" then
      . + [{
        content: ($entry.input.subject // $entry.input.description // "Untitled"),
        status: (
          if ($entry.input.status // "pending") == "not_started" then "pending"
          elif ($entry.input.status // "pending") == "running" then "in_progress"
          elif ($entry.input.status // "pending") == "done" or ($entry.input.status // "pending") == "complete" then "completed"
          else ($entry.input.status // "pending")
          end
        )
      }]
    elif $entry.name == "TaskUpdate" then
      ( ($entry.input.taskId | tostring) // "" ) as $tid |
      if ($tid | test("^[0-9]+$")) then
        ( ($tid | tonumber) - 1 ) as $idx |
        if $idx >= 0 and $idx < length then
          .[$idx] |= (
            (if $entry.input.subject then .content = $entry.input.subject
             elif $entry.input.description then .content = $entry.input.description
             else . end) |
            (if $entry.input.status then
              .status = (
                if $entry.input.status == "not_started" then "pending"
                elif $entry.input.status == "running" then "in_progress"
                elif $entry.input.status == "done" or $entry.input.status == "complete" then "completed"
                else $entry.input.status end
              )
            else . end)
          )
        else . end
      else . end
    else . end
  )
) as $todos |

{
  tools: $tools,
  agents: $agents,
  todos: $todos,
  sessionStart: $sessionStart
}
' "$TRANSCRIPT" > "$CACHE_FILE.tmp" && mv "$CACHE_FILE.tmp" "$CACHE_FILE"

# ── Update last-scan timestamp ──────────────────────────────────────────────
date +%s > "$CACHE_DIR/hud-last-scan"
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x skills/cc-setup/scripts/scan-transcript.sh
```

- [ ] **Step 3: 用 claude-hud 的测试 fixture 验证**

创建测试 fixture 文件并运行：

```bash
mkdir -p /tmp/hud-test/.claude

cat > /tmp/hud-test/transcript.jsonl << 'JSONL'
{"timestamp":"2024-01-01T00:00:00.000Z","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/tmp/example.txt"}}]}}
{"timestamp":"2024-01-01T00:00:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","is_error":false}]}}
{"timestamp":"2024-01-01T00:00:02.000Z","message":{"content":[{"type":"tool_use","id":"agent-1","name":"Task","input":{"subagent_type":"explore","model":"haiku","description":"Finding auth code"}}]}}
{"timestamp":"2024-01-01T00:00:03.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"agent-1","is_error":false}]}}
{"timestamp":"2024-01-01T00:00:04.000Z","message":{"content":[{"type":"tool_use","id":"todo-1","name":"TodoWrite","input":{"todos":[{"content":"First task","status":"completed"},{"content":"Second task","status":"in_progress"}]}}]}}
{"timestamp":"2024-01-01T00:00:05.000Z","message":{"content":[{"type":"tool_use","id":"tool-2","name":"Edit","input":{"file_path":"src/auth.ts"}}]}}
JSONL

bash skills/cc-setup/scripts/scan-transcript.sh /tmp/hud-test/transcript.jsonl /tmp/hud-test
cat /tmp/hud-test/.claude/hud-cache.json | jq .
```

期望输出：
- `tools` 数组有 2 项（Read completed, Edit running）
- `agents` 数组有 1 项（explore completed）
- `todos` 数组有 2 项（First completed, Second in_progress）
- `sessionStart` 不为 null

- [ ] **Step 4: 验证 lock 文件并发控制**

```bash
# 第一次运行应该成功
bash skills/cc-setup/scripts/scan-transcript.sh /tmp/hud-test/transcript.jsonl /tmp/hud-test
ls -la /tmp/hud-test/.claude/hud-scan.lock  # 应该不存在（trap 已清理）

# 模拟 lock 存在时应直接退出
touch /tmp/hud-test/.claude/hud-scan.lock
bash skills/cc-setup/scripts/scan-transcript.sh /tmp/hud-test/transcript.jsonl /tmp/hud-test
echo $?  # 应该是 0（静默退出）
rm /tmp/hud-test/.claude/hud-scan.lock
```

- [ ] **Step 5: 清理测试文件，提交**

```bash
rm -rf /tmp/hud-test
git add skills/cc-setup/scripts/scan-transcript.sh
git commit -m "feat(cc-setup): add scan-transcript.sh for HUD transcript parsing"
```

---

### Task 2: usage-fetch.sh — Usage API 请求

**Files:**
- Create: `skills/cc-setup/scripts/usage-fetch.sh`

从 Keychain/credentials 读 OAuth token，调 Anthropic Usage API，写缓存。

- [ ] **Step 1: 创建脚本**

```bash
#!/usr/bin/env bash
# usage-fetch.sh — 获取 Anthropic Usage API 数据
# 用法: usage-fetch.sh
# 由 statusline.sh 后台触发，一次性执行后退出

set -euo pipefail

CACHE_DIR="$HOME/.claude"
CACHE_FILE="$CACHE_DIR/hud-usage-cache.json"
LOCK_FILE="$CACHE_DIR/hud-usage-fetch.lock"
LOCK_STALE_SECONDS=30
API_TIMEOUT=15

# ── Lock ────────────────────────────────────────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$lock_age" -lt "$LOCK_STALE_SECONDS" ]; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

mkdir -p "$CACHE_DIR"

# ── Check active hours (UTC+8) ──────────────────────────────────────────────
# 读取配置中的活跃时段，默认 9-23
config_file="$CACHE_DIR/hud-config.json"
hour_start=9
hour_end=23
if [ -f "$config_file" ]; then
  hour_start=$(jq -r '.refresh.usageActiveHoursUTC8[0] // 9' "$config_file" 2>/dev/null)
  hour_end=$(jq -r '.refresh.usageActiveHoursUTC8[1] // 23' "$config_file" 2>/dev/null)
fi

utc8_hour=$(TZ=Asia/Shanghai date +%H | sed 's/^0//')
if [ "$utc8_hour" -lt "$hour_start" ] || [ "$utc8_hour" -ge "$hour_end" ]; then
  exit 0
fi

# ── Read OAuth credentials ──────────────────────────────────────────────────
access_token=""
subscription_type=""

# Try macOS Keychain first
if [ "$(uname)" = "Darwin" ]; then
  keychain_data=$(/usr/bin/security find-generic-password \
    -s "Claude Code-credentials" -w 2>/dev/null || true)
  if [ -n "$keychain_data" ]; then
    access_token=$(echo "$keychain_data" | jq -r '.claudeAiOauth.accessToken // ""' 2>/dev/null)
    subscription_type=$(echo "$keychain_data" | jq -r '.claudeAiOauth.subscriptionType // ""' 2>/dev/null)
    # Check token expiry
    expires_at=$(echo "$keychain_data" | jq -r '.claudeAiOauth.expiresAt // 0' 2>/dev/null)
    now_ms=$(date +%s)000
    if [ "$expires_at" != "0" ] && [ "$expires_at" -le "$now_ms" ] 2>/dev/null; then
      access_token=""  # Token expired
    fi
  fi
fi

# Fallback: credentials file
if [ -z "$access_token" ]; then
  cred_file="$CACHE_DIR/.credentials.json"
  if [ -f "$cred_file" ]; then
    access_token=$(jq -r '.claudeAiOauth.accessToken // ""' "$cred_file" 2>/dev/null)
    subscription_type=$(jq -r '.claudeAiOauth.subscriptionType // ""' "$cred_file" 2>/dev/null)
  fi
fi

# No credentials found
if [ -z "$access_token" ]; then
  exit 0
fi

# ── Determine plan name ─────────────────────────────────────────────────────
plan_name=""
sub_lower=$(echo "$subscription_type" | tr '[:upper:]' '[:lower:]')
case "$sub_lower" in
  *max*) plan_name="Max" ;;
  *pro*) plan_name="Pro" ;;
  *team*) plan_name="Team" ;;
  *api*|"") exit 0 ;;  # API user, no usage limits
  *) plan_name="$subscription_type" ;;
esac

# ── Call Usage API ──────────────────────────────────────────────────────────
now=$(date +%s)
response=$(curl -s --max-time "$API_TIMEOUT" \
  -H "Authorization: Bearer $access_token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "User-Agent: claude-code/2.1" \
  "https://api.anthropic.com/api/oauth/usage" 2>/dev/null) || {
  # Network/timeout error — write error cache
  cat > "$CACHE_FILE.tmp" << EOF
{"error":"network","fetchedAt":$now}
EOF
  mv "$CACHE_FILE.tmp" "$CACHE_FILE"
  date +%s > "$CACHE_DIR/hud-usage-last-fetch"
  exit 0
}

# ── Parse response ──────────────────────────────────────────────────────────
echo "$response" | jq --arg plan "$plan_name" --argjson now "$now" '
{
  planName: $plan,
  fiveHour: ((.five_hour.utilization // null) | if . then (. | round | [0, .] | max | [., 100] | min) else null end),
  sevenDay: ((.seven_day.utilization // null) | if . then (. | round | [0, .] | max | [., 100] | min) else null end),
  fiveHourResetAt: (.five_hour.resets_at // null),
  sevenDayResetAt: (.seven_day.resets_at // null),
  fetchedAt: $now
}
' > "$CACHE_FILE.tmp" && mv "$CACHE_FILE.tmp" "$CACHE_FILE"

date +%s > "$CACHE_DIR/hud-usage-last-fetch"
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x skills/cc-setup/scripts/usage-fetch.sh
```

- [ ] **Step 3: 验证活跃时段检查**

```bash
# 当前如果在 UTC+8 9-23 之间，脚本会尝试获取凭据
# 验证脚本不会崩溃（即使没有凭据）
bash skills/cc-setup/scripts/usage-fetch.sh
echo $?  # 应该是 0
```

- [ ] **Step 4: 提交**

```bash
git add skills/cc-setup/scripts/usage-fetch.sh
git commit -m "feat(cc-setup): add usage-fetch.sh for Anthropic Usage API"
```

---

### Task 3: statusline.sh — 扩展读缓存 + 渲染 + 触发后台

**Files:**
- Modify: `skills/cc-setup/scripts/statusline.sh`

在现有基础上增加：读配置、读缓存、渲染 tools/agents/todos/usage 行、触发后台脚本。

- [ ] **Step 1: 扩展 stdin 解析，提取 transcript_path**

在现有 `eval "$(echo "$input" | jq -r ...)"` 中增加 `transcript_path` 字段：

```bash
# 在现有 jq 解析中添加这一行
@sh "transcript_path=\(.transcript_path // "")",
```

- [ ] **Step 2: 添加配置读取**

在 stdin 解析后、颜色定义前，添加配置读取块：

```bash
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
```

- [ ] **Step 3: 更新目录显示使用 pathLevels 配置**

替换现有的目录截断逻辑：

```bash
# ── Directory ────────────────────────────────────────────────────────────────
home="$HOME"
short_dir="${cwd/#$home/\~}"
# 使用配置的 pathLevels
IFS='/' read -ra segs <<< "$cwd"
if [ "${#segs[@]}" -gt "$cfg_pathLevels" ]; then
  short_dir=$(IFS='/'; echo "${segs[*]: -$cfg_pathLevels}")
fi
```

- [ ] **Step 4: 在基础行输出后，添加 tools 渲染**

在 `printf '%b\n' "$out"` 之前，收集额外行到数组：

```bash
# ── Extra lines (tools / agents / todos / usage) ───────────────────────────
extra_lines=()

# ── Tools ────────────────────────────────────────────────────────────────────
if [ "$cfg_showTools" = "true" ] && [ -f "$cwd/.claude/hud-cache.json" ]; then
  tools_line=$(jq -r '
    .tools // [] |
    ( [ .[] | select(.status == "running") ] | .[-2:] ) as $running |
    ( [ .[] | select(.status == "completed" or .status == "error") ]
      | group_by(.name) | map({ name: .[0].name, count: length })
      | sort_by(-.count) | .[:4]
    ) as $completed |
    [
      ( $running[] | "\u001b[33m◐\u001b[0m \u001b[36m\(.name)\u001b[0m" +
        (if .target then "\u001b[2m: \(.target[:20])\u001b[0m" else "" end)
      ),
      ( $completed[] | "\u001b[32m✓\u001b[0m \(.name) \u001b[2m×\(.count)\u001b[0m" )
    ] | join(" | ") // empty
  ' "$cwd/.claude/hud-cache.json" 2>/dev/null) || true
  [ -n "$tools_line" ] && extra_lines+=("$tools_line")
fi
```

- [ ] **Step 5: 添加 agents 渲染**

```bash
# ── Agents ───────────────────────────────────────────────────────────────────
if [ "$cfg_showAgents" = "true" ] && [ -f "$cwd/.claude/hud-cache.json" ]; then
  agents_line=$(jq -r --argjson now "$(date +%s)" '
    .agents // [] |
    ( [ .[] | select(.status == "running") ] ) as $running |
    ( [ .[] | select(.status == "completed") ] | .[-2:] ) as $recent |
    ( $running + $recent ) | .[-3:] | .[] |
    ( if .status == "running" then "\u001b[33m◐\u001b[0m"
      else "\u001b[32m✓\u001b[0m" end ) as $icon |
    ( .type // "unknown" ) as $type |
    ( if .model then " \u001b[2m[\(.model)]\u001b[0m" else "" end ) as $model |
    ( if .description then "\u001b[2m: \(.description[:40])\u001b[0m" else "" end ) as $desc |
    ( ( ( if .endTime then (.endTime | sub("\\.[0-9]+Z$"; "Z") | fromdate)
          else $now end ) -
        (.startTime | sub("\\.[0-9]+Z$"; "Z") | fromdate) ) |
      if . < 60 then "\(.)s"
      elif . < 3600 then "\(. / 60 | floor)m \(. % 60)s"
      else "\(. / 3600 | floor)h \((. % 3600) / 60 | floor)m"
      end
    ) as $elapsed |
    "\($icon) \u001b[35m\($type)\u001b[0m\($model)\($desc) \u001b[2m(\($elapsed))\u001b[0m"
  ' "$cwd/.claude/hud-cache.json" 2>/dev/null) || true
  if [ -n "$agents_line" ]; then
    while IFS= read -r line; do
      extra_lines+=("$line")
    done <<< "$agents_line"
  fi
fi
```

- [ ] **Step 6: 添加 todos 渲染**

```bash
# ── Todos ────────────────────────────────────────────────────────────────────
if [ "$cfg_showTodos" = "true" ] && [ -f "$cwd/.claude/hud-cache.json" ]; then
  todos_line=$(jq -r '
    .todos // [] |
    if length == 0 then empty
    else
      ( [ .[] | select(.status == "completed") ] | length ) as $done |
      ( length ) as $total |
      ( [ .[] | select(.status == "in_progress") ] | first // null ) as $current |
      if $current then
        "\u001b[33m▸\u001b[0m \($current.content[:50]) \u001b[2m(\($done)/\($total))\u001b[0m"
      elif $done == $total and $total > 0 then
        "\u001b[32m✓\u001b[0m All todos complete \u001b[2m(\($done)/\($total))\u001b[0m"
      else empty end
    end
  ' "$cwd/.claude/hud-cache.json" 2>/dev/null) || true
  [ -n "$todos_line" ] && extra_lines+=("$todos_line")
fi
```

- [ ] **Step 7: 添加 usage 渲染**

```bash
# ── Usage ────────────────────────────────────────────────────────────────────
if [ "$cfg_showUsage" = "true" ] && [ -f "$HOME/.claude/hud-usage-cache.json" ]; then
  usage_line=$(jq -r '
    if .error then empty
    elif .fiveHour == null then empty
    else
      .fiveHour as $pct |
      ( if $pct >= 100 then "\u001b[31m"       # red
        elif $pct >= 80 then "\u001b[35m"       # magenta
        else "\u001b[34m" end                   # blue
      ) as $color |
      ( ($pct * 10 / 100) | floor ) as $filled |
      ( 10 - $filled ) as $empty |
      ( [ range($filled) | "█" ] | join("") ) as $bar_filled |
      ( [ range($empty) | "░" ] | join("") ) as $bar_empty |
      # Reset time
      ( if .fiveHourResetAt then
          ( (.fiveHourResetAt | sub("\\.[0-9]+Z$"; "Z") | fromdate) - now |
            if . < 0 then "now"
            elif . < 3600 then "\(. / 60 | floor)m"
            else "\(. / 3600 | floor)h \((. % 3600) / 60 | floor)m"
            end )
        else "" end
      ) as $reset |
      ( if .planName then "\(.planName) " else "" end ) as $plan |
      "\($plan)\($color)\($bar_filled)\($bar_empty)\u001b[0m \($color)\($pct)%\u001b[0m" +
      ( if $reset != "" then " \u001b[2m(\($reset) left)\u001b[0m" else "" end )
    end
  ' "$HOME/.claude/hud-usage-cache.json" 2>/dev/null) || true
  [ -n "$usage_line" ] && extra_lines+=("$usage_line")
fi
```

- [ ] **Step 8: 输出额外行**

在现有 `printf '%b\n' "$out"` 之后添加：

```bash
# ── Output extra lines ──────────────────────────────────────────────────────
for eline in "${extra_lines[@]}"; do
  printf '%b\n' "$eline"
done
```

- [ ] **Step 9: 添加后台触发逻辑**

在脚本末尾（所有输出之后）添加：

```bash
# ── Trigger background scans ───────────────────────────────────────────────
now=$(date +%s)

# Transcript scan
needs_scan="false"
if [ "$cfg_showTools" = "true" ] || [ "$cfg_showAgents" = "true" ] || [ "$cfg_showTodos" = "true" ]; then
  if [ -n "$transcript_path" ] && [ -n "$cwd" ]; then
    last_scan=0
    [ -f "$cwd/.claude/hud-last-scan" ] && last_scan=$(cat "$cwd/.claude/hud-last-scan" 2>/dev/null || echo 0)
    if [ $(( now - last_scan )) -ge "$cfg_transcriptRefresh" ]; then
      "$SCRIPT_DIR/scan-transcript.sh" "$transcript_path" "$cwd" &>/dev/null & disown
    fi
  fi
fi

# Usage fetch
if [ "$cfg_showUsage" = "true" ]; then
  last_fetch=0
  [ -f "$HOME/.claude/hud-usage-last-fetch" ] && last_fetch=$(cat "$HOME/.claude/hud-usage-last-fetch" 2>/dev/null || echo 0)
  if [ $(( now - last_fetch )) -ge "$cfg_usageRefresh" ]; then
    "$SCRIPT_DIR/usage-fetch.sh" &>/dev/null & disown
  fi
fi
```

- [ ] **Step 10: 验证完整 statusline 渲染**

创建模拟数据验证渲染效果：

```bash
# 创建模拟配置
mkdir -p ~/.claude
cat > ~/.claude/hud-config.json << 'EOF'
{
  "pathLevels": 2,
  "display": { "showTools": true, "showAgents": true, "showTodos": true, "showUsage": true },
  "refresh": { "transcriptRefreshSeconds": 5, "usageRefreshSeconds": 3600, "usageActiveHoursUTC8": [9, 23] }
}
EOF

# 创建模拟缓存
mkdir -p /tmp/hud-render-test/.claude
cat > /tmp/hud-render-test/.claude/hud-cache.json << 'EOF'
{
  "tools": [
    {"id":"1","name":"Read","target":"src/index.ts","status":"completed","startTime":"2024-01-01T00:00:00Z"},
    {"id":"2","name":"Read","target":"src/auth.ts","status":"completed","startTime":"2024-01-01T00:00:01Z"},
    {"id":"3","name":"Edit","target":"src/auth.ts","status":"running","startTime":"2024-01-01T00:00:02Z"}
  ],
  "agents": [
    {"id":"a1","type":"explore","model":"haiku","description":"Finding auth code","status":"running","startTime":"2024-01-01T00:00:00Z"}
  ],
  "todos": [
    {"content":"Fix authentication bug","status":"in_progress"},
    {"content":"Add tests","status":"pending"},
    {"content":"Setup CI","status":"completed"}
  ]
}
EOF

cat > ~/.claude/hud-usage-cache.json << 'EOF'
{"planName":"Max","fiveHour":25,"sevenDay":60,"fiveHourResetAt":"2026-03-19T20:00:00Z","fetchedAt":1710000000}
EOF

# 用模拟 stdin 测试渲染
echo '{"cwd":"/tmp/hud-render-test","model":{"display_name":"Opus"},"context_window":{"used_percentage":45,"remaining_percentage":55,"context_window_size":200000},"cost":{"total_cost_usd":0.47}}' | \
  bash skills/cc-setup/scripts/statusline.sh
```

期望输出类似：

```
hud-render-test | ... | Opus | ctx 45% [====------] 90/200k · $0.47
◐ Edit: src/auth.ts | ✓ Read ×2
◐ explore [haiku]: Finding auth code (...)
▸ Fix authentication bug (1/3)
Max █░░░░░░░░░ 25% (... left)
```

- [ ] **Step 11: 清理测试数据，提交**

```bash
rm -rf /tmp/hud-render-test
# 保留 ~/.claude/hud-config.json（用户自己的配置）
git add skills/cc-setup/scripts/statusline.sh
git commit -m "feat(cc-setup): extend statusline with tools, agents, todos, usage rendering"
```

---

### Task 4: SKILL.md — 更新引导流程文档

**Files:**
- Modify: `skills/cc-setup/SKILL.md`

在"配置项"部分更新 HUD 状态栏项，添加子选项说明。

- [ ] **Step 1: 更新 SKILL.md 的 HUD 状态栏配置项**

在 `### 2. HUD 状态栏` 部分，替换为：

```markdown
### 2. HUD 状态栏

配置 statusLine 显示项目路径、git 分支、模型、上下文用量、费用，以及可选的工具活动、Agent 追踪、Todo 进度、Usage 限额。

**检测**：检查目标 settings 中是否存在 `statusLine` 配置

**开启时**：将 `scripts/statusline.sh` 的路径写入 `statusLine.command`

**关闭时**：删除 `statusLine` 字段

**HUD 子选项**（开启状态栏后依次询问，选择结果写入 `~/.claude/hud-config.json`）：

| 子选项 | 配置字段 | 默认 | 说明 |
|--------|----------|------|------|
| 工具活动 | `display.showTools` | 关 | 显示正在运行和已完成的工具调用 |
| Agent 追踪 | `display.showAgents` | 关 | 显示子 Agent 状态和耗时 |
| Todo 进度 | `display.showTodos` | 关 | 显示当前任务和完成进度 |
| Usage 限额 | `display.showUsage` | 关 | 显示 Pro/Max/Team 用量百分比（每小时刷新，UTC+8 9-23 点） |

**配置文件**：`~/.claude/hud-config.json`，完整配置参考 `docs/superpowers/specs/2026-03-19-cc-setup-hud-design.md`
```

- [ ] **Step 2: 提交**

```bash
git add skills/cc-setup/SKILL.md
git commit -m "docs(cc-setup): update SKILL.md with HUD sub-options"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 用真实 Claude Code session 验证 transcript 解析**

在一个真实 Claude Code 会话中：
1. 确认 `~/.claude/hud-config.json` 存在且 showTools/showAgents/showTodos/showUsage 为 true
2. 确认 statusline 正在运行（`/statusline` 或检查 settings 中的 `statusLine.command`）
3. 执行一些操作（读文件、搜索等），观察 statusline 是否显示工具活动
4. 检查 `.claude/hud-cache.json` 是否被正确写入
5. 检查 `~/.claude/hud-usage-cache.json` 是否被正确写入（如果在活跃时段）

- [ ] **Step 2: 验证限流**

```bash
# 检查 hud-last-scan 时间戳在 5 秒内不会重复触发
cat .claude/hud-last-scan  # 记录时间
sleep 3
cat .claude/hud-last-scan  # 应该相同（未超过 5 秒）
sleep 3
cat .claude/hud-last-scan  # 应该更新了（超过 5 秒）
```

- [ ] **Step 3: 验证 usage 活跃时段**

```bash
# 如果当前在 UTC+8 9-23 之外，hud-usage-last-fetch 不应更新
TZ=Asia/Shanghai date +%H  # 确认当前时间
cat ~/.claude/hud-usage-last-fetch 2>/dev/null  # 检查是否存在
```
