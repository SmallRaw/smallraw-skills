---
name: openclaw-tmux-agent
description: 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作
license: MIT
compatibility: claude-code, opencode, gemini-cli, codex
metadata:
  openclaw:
    requires:
      bins: [tmux]
      env: []
      config: []
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: false
disable-model-invocation: false
---

# openclaw-tmux-agent — 多 AI CLI 工具调度协议

> 通过 tmux 实现 AI Agent 对其他 AI CLI 工具的持久化调度。专为 OpenClaw 设计。

---

## 何时使用

- 需要将子任务委派给其他 AI CLI 工具（claude-code、opencode、gemini-cli、codex 等）执行
- 需要并行运行多个 AI CLI 工具实例，各自处理不同任务
- 需要检查已派发任务的运行状态、读取输出结果
- 断线重连后需要恢复对已有 Agent 的管理（session 仍在，状态文件仍存）

---

## 架构概览

```
┌─────────────────────────────────────────────────┐
│  Layer 3 — 生命周期管理                          │
│  重启 / 回收 / 清理 / 重连恢复                    │
│  → knowledge/lifecycle-management.md             │
├─────────────────────────────────────────────────┤
│  Layer 2 — 任务状态协议                          │
│  .tmux-agents.json 状态文件读写                   │
│  → knowledge/state-protocol.md                │
├─────────────────────────────────────────────────┤
│  Layer 1 — tmux 原语                             │
│  new-session / new-window / send-keys /          │
│  capture-pane / list-panes / kill-window         │
│  → knowledge/tmux-primitives.md                  │
└─────────────────────────────────────────────────┘
```

- **Layer 1** 是底层命令层，封装 tmux 操作细节
- **Layer 2** 是状态持久化层，所有 Agent 信息记录到 `.tmux-agents.json`
- **Layer 3** 是管理层，处理异常恢复、进程重启、资源回收等高层逻辑

---

## 核心工作流

### 1. 初始化调度环境

检查 tmux 是否安装，创建调度 session，初始化状态文件。

```bash
# 检查 tmux 是否可用
command -v tmux >/dev/null 2>&1 || { echo "tmux 未安装"; exit 1; }

# 创建调度 session（detached 模式）
tmux new-session -d -s openclaw-agents

# 初始化状态文件
echo '{"session":"openclaw-agents","agents":{}}' > .tmux-agents.json
```

> **注意**：如果 `.tmux-agents.json` 已存在，说明之前有调度环境。跳转到 **步骤 6（重连恢复）** 而非重新初始化。

### 2. 派发任务

严格按以下顺序执行，不可跳步：

**第一步：创建 window**

```bash
tmux new-window -t openclaw-agents -n "task-refactor"
```

**第二步：写入状态文件**

在状态文件中记录新 Agent 条目（此时 pid 为 null，status 为 "starting"）：

```bash
# 用 jq 追加记录（示例）
jq '.agents["task-refactor"] = {"window":"task-refactor","cmd":"claude-code","status":"starting","pid":null,"created":"2026-03-04T10:00:00Z"}' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

**第三步：发送命令**

```bash
tmux send-keys -t openclaw-agents:task-refactor "claude-code --task '重构 utils 模块'" Enter
```

**第四步：确认进程启动**

```bash
# 等待进程启动（短暂延迟）
sleep 2

# 获取 pane pid
PANE_PID=$(tmux display-message -t openclaw-agents:task-refactor -p '#{pane_pid}')
echo "pane_pid: $PANE_PID"

# 找到实际子进程 pid
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)
echo "child_pid: $CHILD_PID"
```

**第五步：更新 pid 到状态文件**

```bash
jq --arg pid "$CHILD_PID" '.agents["task-refactor"].pid = ($pid | tonumber) | .agents["task-refactor"].status = "running"' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

### 3. 检查状态

组合 tmux pane 信息与系统进程状态，判断 Agent 是否存活。

```bash
# 检查 pane 是否存活
tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_pid} #{pane_dead}' 2>/dev/null

# 检查进程是否存在（使用状态文件中记录的 pid）
PID=$(jq -r '.agents["task-refactor"].pid' .tmux-agents.json)
if ps -p "$PID" > /dev/null 2>&1; then
  echo "Agent 运行中"
else
  echo "Agent 已退出"
  # 更新状态文件
  jq '.agents["task-refactor"].status = "exited"' \
    .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
fi
```

### 4. 收集结果

使用 `capture-pane` 读取 Agent 输出。

```bash
# 读取最后 50 行输出
tmux capture-pane -t openclaw-agents:task-refactor -p -S -50

# 读取指定范围（从第 10 行到第 30 行）
tmux capture-pane -t openclaw-agents:task-refactor -p -S -30 -E -10

# 读取全部历史（scrollback buffer）
tmux capture-pane -t openclaw-agents:task-refactor -p -S -
```

### 5. 生命周期管理

详细参考 `knowledge/lifecycle-management.md`。

**重启（restart）**：Agent 异常退出后重新执行。

```bash
# 在同一 window 重新发送命令
tmux send-keys -t openclaw-agents:task-refactor "claude-code --task '重构 utils 模块'" Enter

# 等待并更新 pid
sleep 2
PANE_PID=$(tmux display-message -t openclaw-agents:task-refactor -p '#{pane_pid}')
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)

jq --arg pid "$CHILD_PID" '.agents["task-refactor"].pid = ($pid | tonumber) | .agents["task-refactor"].status = "running"' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

**回收（reclaim）**：任务完成或不再需要，销毁 window 并移除状态记录。

```bash
# 销毁 window
tmux kill-window -t openclaw-agents:task-refactor

# 从状态文件移除
jq 'del(.agents["task-refactor"])' \
  .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
```

**清理（cleanup）**：全部任务完成，销毁 session 和状态文件。

```bash
# 销毁整个 session
tmux kill-session -t openclaw-agents

# 删除状态文件
rm .tmux-agents.json
```

### 6. 重连恢复

断线重连或新会话启动时，通过状态文件恢复管理。

**恢复流程**：读状态文件 → 检查 session 存在 → 逐个验证 pid → 修正状态 → 报告。

```bash
# 1. 读取状态文件
cat .tmux-agents.json

# 2. 检查 session 是否存在
tmux has-session -t openclaw-agents 2>/dev/null && echo "session 存在" || echo "session 丢失"

# 3. 逐个验证 Agent pid
for agent in $(jq -r '.agents | keys[]' .tmux-agents.json); do
  PID=$(jq -r --arg a "$agent" '.agents[$a].pid' .tmux-agents.json)
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "$agent (pid=$PID): 运行中"
  else
    echo "$agent (pid=$PID): 已退出"
    # 4. 修正状态
    jq --arg a "$agent" '.agents[$a].status = "exited"' \
      .tmux-agents.json > .tmux-agents.json.tmp && mv .tmux-agents.json.tmp .tmux-agents.json
  fi
done

# 5. 报告当前状态
jq '.agents | to_entries[] | "\(.key): \(.value.status)"' .tmux-agents.json
```

---

## 规则

### 禁止规则

1. **禁止脱离状态文件操作 window**：创建或销毁 tmux window 时，必须同步更新 `.tmux-agents.json`。任何 `new-window` 或 `kill-window` 操作都必须对应状态文件的写入或删除。
2. **禁止不经 pid 检查就假定状态**：不可仅根据状态文件中的 `status` 字段判断 Agent 是否存活。必须用 `ps -p <pid>` 验证进程是否真实存在。
3. **禁止自动删除失败的 window**：Agent 退出或异常时，仅更新状态为 `"exited"` 或 `"failed"`。不要自动 `kill-window`，除非用户明确要求回收。

### 过程规则

1. **任务派发流程**：严格按照 "创建 window → 写入状态文件 → 发送命令 → 确认进程启动 → 更新 pid" 五步执行，不可跳步或乱序。
2. **重连恢复流程**：严格按照 "读状态文件 → 检查 session 存在 → 逐个验证 pid → 修正状态 → 报告" 五步执行。
3. **状态修正原则**：状态文件是声明，tmux + pid 是事实。当声明与事实不一致时，以事实为准修正声明，不可反过来操作。

### 检查清单

在开始调度前，确认以下条件满足：

- [ ] `tmux` 已安装且可执行（`command -v tmux`）
- [ ] 调度 session 存在（`tmux has-session -t openclaw-agents`）或可以创建
- [ ] 状态文件 `.tmux-agents.json` 可读写（检查路径和权限）

---

## 知识库文件

| 文件 | 用途 |
|------|------|
| `knowledge/tmux-primitives.md` | tmux 命令原语参考（new-session、send-keys、capture-pane 等用法与参数） |
| `knowledge/state-protocol.md` | `.tmux-agents.json` 状态文件的 JSON Schema 与字段说明 |
| `knowledge/lifecycle-management.md` | Agent 生命周期管理详解（重启、回收、清理、异常处理策略） |
