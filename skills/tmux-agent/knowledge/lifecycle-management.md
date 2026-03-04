# 工具生命周期管理

> 本文档定义 Agent 从创建到回收的完整生命周期，包括健康检查、完成判定、重启策略、回收策略和异常场景处理。

---

## 1. 生命周期概览

```
创建 window ──→ 发送命令 ──→ 运行中 ──→ 进程退出
                              │              │
                              │         ┌────┴────┐
                              │         │         │
                              │      正常完成   异常退出
                              │     (exited)   (failed)
                              │         │         │
                              │         │    ┌────┴────┐
                              │         │    │         │
                              │         │  重启      放弃
                              │         │    │
                              │         │    └──→ 运行中 ──→ ...
                              │         │
                              │         ▼
                              │      保留 window
                              │     （可收集输出）
                              │         │
                              │         ▼
                              └──→   回收 window
                                  （kill-window +
                                   删除状态条目）
```

**关键规则**：
- 异常退出（`failed`）的 window 不会被自动回收，必须由主控 Agent 明确决定重启或放弃
- 正常完成（`exited`）的 window 保留直到主控 Agent 收集输出后主动回收
- 回收操作始终包含两步：销毁 tmux window + 从状态文件删除条目

---

## 2. 健康检查

健康检查用于判断 Agent 进程是否仍然存活。提供三种检测方法，推荐组合使用。

### 方法一：pane_dead 标志

**前提**：需要预先设置 `remain-on-exit` 选项。

```bash
# 设置 remain-on-exit（建议在创建 window 后立即执行）
tmux set-option -t openclaw-agents:task-refactor remain-on-exit on

# 检查 pane 是否已终止
DEAD=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_dead}')
if [ "$DEAD" = "1" ]; then
  echo "Agent 进程已退出"
else
  echo "Agent 进程仍在运行"
fi
```

**优点**：tmux 原生支持，无需知道 pid。
**缺点**：需要预先开启 `remain-on-exit`，否则 pane 在进程退出后会自动关闭。

### 方法二：pid 存活检查

直接使用状态文件中记录的 pid 检查进程是否存在。

```bash
PID=$(jq -r '.agents["task-refactor"].pid' .tmux-agents.json)

if ps -p "$PID" > /dev/null 2>&1; then
  echo "Agent 运行中 (pid=$PID)"
else
  echo "Agent 已退出 (pid=$PID)"
fi
```

**优点**：简单直接，不依赖 tmux 选项。
**缺点**：PID 可能被复用（极端情况下），需结合其他方法确认。

### 方法三：子进程检查

检查 pane 的 shell 进程是否有子进程（即 Agent 工具进程）。

```bash
PANE_PID=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_pid}')
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)

if [ -n "$CHILD_PID" ]; then
  echo "Agent 运行中 (child_pid=$CHILD_PID)"
else
  echo "无子进程 — Agent 已完成或未启动"
fi
```

**优点**：能准确反映当前时刻的实际状态，不依赖历史记录的 pid。
**缺点**：如果 Agent 进程产生了孙子进程，可能需要递归检测。

### 僵尸进程检测

进程可能处于僵尸状态（已退出但未被父进程回收），此时 `ps -p` 仍会返回成功。需要额外检查：

```bash
STAT=$(ps -p "$PID" -o stat= 2>/dev/null)
if [ "$STAT" = "Z" ] || [ "$STAT" = "Z+" ]; then
  echo "僵尸进程，视为已退出"
fi
```

### 推荐检查流程

```bash
# 综合健康检查
check_agent_health() {
  local AGENT_NAME="$1"
  local PID=$(jq -r --arg n "$AGENT_NAME" '.agents[$n].pid' .tmux-agents.json)

  # 1. 检查 pid 是否存在
  if ! ps -p "$PID" > /dev/null 2>&1; then
    echo "exited_or_failed"
    return
  fi

  # 2. 检查是否为僵尸进程
  local STAT=$(ps -p "$PID" -o stat= 2>/dev/null)
  if [ "$STAT" = "Z" ] || [ "$STAT" = "Z+" ]; then
    echo "zombie"
    return
  fi

  # 3. 确认仍在运行
  echo "running"
}
```

---

## 3. 完成判定

"完成"指 Agent 进程已退出，不再执行任何工作。

### 完成的三种判据（满足任一即可）

| 判据 | 检测方式 | 说明 |
|------|----------|------|
| pane 已终止 | `#{pane_dead}` = `1` | 需要 `remain-on-exit` 开启 |
| pid 不存在 | `ps -p <pid>` 返回非零 | 直接检查进程表 |
| shell 存活但无子进程 | `pgrep -P <pane_pid>` 无输出 | shell 还在，但 Agent 工具已退出 |

### 重要区分：完成 ≠ 成功

完成（completed）仅表示进程不再运行，不代表任务成功。进程退出后需要进一步判断：

- **正常完成 → `exited`**：退出码为 0，或输出内容包含成功标志
- **异常退出 → `failed`**：退出码非零，或输出内容包含错误信息

```bash
# 判定完成后，读取输出判断成功与否
OUTPUT=$(tmux capture-pane -t openclaw-agents:task-refactor -p -S -30)

# 根据输出内容判断（示例逻辑）
if echo "$OUTPUT" | grep -qi "error\|panic\|fatal\|crash"; then
  NEW_STATUS="failed"
else
  NEW_STATUS="exited"
fi

# 更新状态文件
jq --arg s "$NEW_STATUS" \
   --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.agents["task-refactor"].status = $s | .agents["task-refactor"].finished_at = $t' \
   .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

---

## 4. 重启策略

### 何时重启

仅在以下条件同时满足时重启：
1. Agent 状态为 `"failed"`
2. 主控 Agent 明确要求重启（不自动重启）

> 状态为 `"exited"` 的 Agent 不允许重启。已正常完成的任务应该创建新 Agent 而非重启旧的。

### 重启方式

**方式一：在同一 window 重新发送命令（推荐）**

```bash
# 重新发送命令
tmux send-keys -t openclaw-agents:task-docs "gemini-cli --task '生成 API 文档'" Enter

# 等待启动
sleep 2

# 获取新 pid
PANE_PID=$(tmux list-panes -t openclaw-agents:task-docs -F '#{pane_pid}')
NEW_PID=$(pgrep -P "$PANE_PID" | head -1)

# 更新状态文件
jq --arg pid "$NEW_PID" \
   '.agents["task-docs"].pid = ($pid | tonumber) | .agents["task-docs"].status = "running" | .agents["task-docs"].restart_count += 1 | .agents["task-docs"].finished_at = null' \
   .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

**方式二：使用 respawn-pane（需要 remain-on-exit）**

```bash
# 在 pane 已 dead 的情况下重新启动
tmux respawn-pane -k -t openclaw-agents:task-docs "gemini-cli --task '生成 API 文档'"
```

> `respawn-pane -k` 会杀死当前 pane 的进程（如果还在运行）并重新启动。适用于 pane 设置了 `remain-on-exit` 的场景。

### 状态更新

重启时必须更新以下字段：
- `status`：`"failed"` → `"running"`
- `pid`：更新为新进程的 pid
- `restart_count`：加 1
- `finished_at`：置为 `null`

### 最大重启次数

推荐最大重启次数为 **3 次**。超过后应停止重启并报告给主控 Agent：

```bash
RESTART_COUNT=$(jq -r '.agents["task-docs"].restart_count' .tmux-agents.json)
if [ "$RESTART_COUNT" -ge 3 ]; then
  echo "Agent task-docs 已重启 $RESTART_COUNT 次，不再重试。请检查任务配置或手动介入。"
else
  echo "执行第 $((RESTART_COUNT + 1)) 次重启..."
  # ... 重启逻辑 ...
fi
```

---

## 5. 回收策略

### 单个 Agent 回收

销毁 window 并从状态文件中移除条目。

```bash
# 第一步：销毁 tmux window
tmux kill-window -t openclaw-agents:task-refactor

# 第二步：从状态文件移除
jq 'del(.agents["task-refactor"])' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

> 两步必须都执行。只删 window 不更新状态文件会导致不一致；只更新状态文件不删 window 会留下孤儿 window。

### 全部清理

所有任务完成后，销毁整个 session 并删除状态文件。

```bash
# 销毁 session（自动销毁其下所有 window）
tmux kill-session -t openclaw-agents

# 删除状态文件
rm .tmux-agents.json
```

### 不可回收的情况

以下情况禁止回收，必须等待条件满足后才能操作：

| 情况 | 原因 | 正确做法 |
|------|------|----------|
| status=`"failed"` 且未经主控确认 | 主控可能需要查看输出或决定重启 | 等待主控明确指示回收或重启 |
| status=`"running"` | 进程仍在执行任务 | 等待进程退出，或先发送 `C-c` 中断 |
| status=`"starting"` | 进程可能即将启动 | 等待状态转为 `running` 或 `failed` |

---

## 6. 异常场景处理

### 场景 A：tmux server 崩溃

**症状**：所有 tmux 命令报错 `no server running`，但 `.tmux-agents.json` 仍然存在。

**处理步骤**：

```bash
# 1. 确认 tmux server 不可用
tmux has-session -t openclaw-agents 2>/dev/null
# 返回非零 — server 不存在

# 2. 重建 session
tmux new-session -d -s openclaw-agents

# 3. 将所有 running 状态的 Agent 标记为 failed
jq '(.agents | to_entries | map(select(.value.status == "running" or .value.status == "starting")) | .[].key) as $k | .agents[$k].status = "failed" | .agents[$k].finished_at = now | .agents[$k].pid = null' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json

# 4. 报告给主控 Agent，由其决定哪些需要重启
jq '.agents | to_entries[] | "\(.key): \(.value.status)"' .tmux-agents.json
```

**简化版修正**（逐个处理）：

```bash
# 对每个 running/starting 的 Agent 修正状态
for agent in $(jq -r '.agents | to_entries[] | select(.value.status == "running" or .value.status == "starting") | .key' .tmux-agents.json); do
  jq --arg a "$agent" \
     --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '.agents[$a].status = "failed" | .agents[$a].finished_at = $t | .agents[$a].pid = null' \
     .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
done
```

### 场景 B：状态文件损坏或丢失

**症状**：`.tmux-agents.json` 不存在或内容无法解析，但 tmux session 和 window 可能仍在运行。

**处理步骤**：

```bash
# 1. 检查 session 是否存在
tmux has-session -t openclaw-agents 2>/dev/null || {
  echo "Session 也不存在，从零开始"
  echo '{"session":"openclaw-agents","created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","agents":{}}' > .tmux-agents.json
  tmux new-session -d -s openclaw-agents
  exit 0
}

# 2. 从 tmux 列出现有 window，重建状态文件
echo '{"session":"openclaw-agents","created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","agents":{}}' > .tmux-agents.json

for win in $(tmux list-windows -t openclaw-agents -F '#{window_name}'); do
  PANE_PID=$(tmux list-panes -t "openclaw-agents:$win" -F '#{pane_pid}')
  CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)

  if [ -n "$CHILD_PID" ]; then
    STATUS="running"
    PID_VAL="$CHILD_PID"
  else
    STATUS="exited"
    PID_VAL="null"
  fi

  jq --arg name "$win" --arg status "$STATUS" --arg pid "$PID_VAL" \
     --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '.agents[$name] = {"window":$name,"cmd":"unknown","task":"recovered","status":$status,"pid":(if $pid == "null" then null else ($pid | tonumber) end),"created":$t,"finished_at":null,"restart_count":0}' \
     .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
done

# 3. 报告恢复结果
echo "状态文件已从 tmux 重建："
jq '.agents | to_entries[] | "\(.key): \(.value.status)"' .tmux-agents.json
```

### 场景 C：window 存在但状态文件无对应条目

**症状**：tmux 中存在某个 window，但 `.tmux-agents.json` 中没有该 Agent 的记录。

**处理步骤**：

```bash
# 发现未记录的 window 后，补充条目
WINDOW_NAME="unknown-task"
PANE_PID=$(tmux list-panes -t "openclaw-agents:$WINDOW_NAME" -F '#{pane_pid}')
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)

if [ -n "$CHILD_PID" ]; then
  STATUS="running"
  PID_VAL="$CHILD_PID"
else
  STATUS="exited"
  PID_VAL="null"
fi

jq --arg name "$WINDOW_NAME" --arg status "$STATUS" --arg pid "$PID_VAL" \
   --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.agents[$name] = {"window":$name,"cmd":"unknown","task":"未知（从 tmux 恢复）","status":$status,"pid":(if $pid == "null" then null else ($pid | tonumber) end),"created":$t,"finished_at":null,"restart_count":0}' \
   .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

### 场景 D：状态文件有条目但 window 已消失

**症状**：`.tmux-agents.json` 中存在某个 Agent 记录，但对应的 tmux window 不存在。

**处理步骤**：

```bash
AGENT_NAME="task-refactor"

# 检查 window 是否存在
if ! tmux list-windows -t openclaw-agents -F '#{window_name}' | grep -q "^${AGENT_NAME}$"; then
  echo "Window $AGENT_NAME 已消失，标记为 failed"

  jq --arg a "$AGENT_NAME" \
     --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '.agents[$a].status = "failed" | .agents[$a].finished_at = $t | .agents[$a].pid = null' \
     .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
fi
```

> **注意**：标记为 `"failed"` 而非直接删除。主控 Agent 需要知道这个 Agent 曾经存在但异常丢失，以便决定是否需要重新派发任务。
