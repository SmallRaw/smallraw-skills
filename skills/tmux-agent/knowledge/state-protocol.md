# 状态文件协议

> `.tmux-agents.json` 是 tmux-agent 调度系统的持久化状态文件。
> 它记录所有 Agent 的元信息和运行状态，是断线重连和状态恢复的唯一依据。

---

## 1. 文件位置

- **路径**：项目根目录下的 `.tmux-agents.json`
- **生命周期**：调度环境初始化时创建，全部清理时删除
- **权限**：当前用户可读写

> **必须**将 `.tmux-agents.json` 添加到 `.gitignore`，该文件仅用于本地调度，不应纳入版本控制。

```bash
# 确保 .gitignore 中包含该文件
echo '.tmux-agents.json' >> .gitignore
```

---

## 2. JSON Schema

```json
{
  "session": "string — tmux session 名称",
  "created_at": "string — ISO 8601 格式的创建时间",
  "agents": {
    "<agent-name>": {
      "window": "string — tmux window 名称",
      "cmd": "string — 执行的工具命令",
      "task": "string — 任务描述",
      "status": "string — starting | running | exited | failed",
      "pid": "number | null — Agent 进程 PID，启动前为 null",
      "created": "string — ISO 8601 格式的创建时间",
      "finished_at": "string | null — ISO 8601 格式的结束时间，未结束时为 null",
      "restart_count": "number — 重启次数，默认 0"
    }
  }
}
```

### 字段说明

**顶层字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session` | string | 是 | tmux session 名称，如 `"openclaw-agents"` |
| `created_at` | string | 是 | 状态文件创建时间，ISO 8601 格式 |
| `agents` | object | 是 | Agent 记录映射表，key 为 Agent 名称 |

**Agent 条目字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `window` | string | 是 | tmux window 名称，通常与 Agent 名称相同 |
| `cmd` | string | 是 | 执行的 CLI 工具命令，如 `"claude-code"`, `"opencode"` |
| `task` | string | 是 | 任务描述文本 |
| `status` | string | 是 | 当前状态：`"starting"`, `"running"`, `"exited"`, `"failed"` |
| `pid` | number \| null | 是 | Agent 进程 PID；创建 window 后尚未启动时为 `null` |
| `created` | string | 是 | Agent 创建时间，ISO 8601 格式 |
| `finished_at` | string \| null | 否 | 进程结束时间；运行中或未启动时为 `null` |
| `restart_count` | number | 否 | 重启次数，初始为 `0` |

> **关键设计**：`agents` 是 **对象（object/map）**，以 Agent 名称为 key，不是数组。
> 这使得通过名称查找、更新、删除操作可直接使用 `.agents["<name>"]`，无需遍历。

---

## 3. 完整示例

以下示例展示了包含 3 个不同状态 Agent 的状态文件：

```json
{
  "session": "openclaw-agents",
  "created_at": "2026-03-04T10:00:00Z",
  "agents": {
    "task-refactor": {
      "window": "task-refactor",
      "cmd": "claude-code",
      "task": "重构 utils 模块，拆分为独立的 helper 函数",
      "status": "running",
      "pid": 28451,
      "created": "2026-03-04T10:01:00Z",
      "finished_at": null,
      "restart_count": 0
    },
    "task-test": {
      "window": "task-test",
      "cmd": "opencode",
      "task": "为 auth 模块编写单元测试，覆盖率达到 80%",
      "status": "exited",
      "pid": 28523,
      "created": "2026-03-04T10:02:00Z",
      "finished_at": "2026-03-04T10:15:30Z",
      "restart_count": 0
    },
    "task-docs": {
      "window": "task-docs",
      "cmd": "gemini-cli",
      "task": "生成 API 文档",
      "status": "failed",
      "pid": 28610,
      "created": "2026-03-04T10:03:00Z",
      "finished_at": "2026-03-04T10:05:12Z",
      "restart_count": 1
    }
  }
}
```

**解读**：
- `task-refactor`：正在运行，pid 28451 存活
- `task-test`：已正常退出，可以收集输出并回收
- `task-docs`：执行失败（已重启过 1 次），需要主控 Agent 决定是否再次重启或回收

---

## 4. 状态流转

```
                ┌──────────┐
                │ starting │  ← 创建 window，写入状态文件
                └────┬─────┘
                     │  确认 pid 后
                     ▼
                ┌──────────┐
         ┌──────│ running  │
         │      └────┬─────┘
         │           │  进程退出
         │           ▼
         │    ┌──────────────┐
         │    │ exited 或     │  ← 根据退出码/输出内容判断
         │    │ failed       │
         │    └──────┬───────┘
         │           │
         │     ┌─────┴─────┐
         │     │            │
         │     ▼            ▼
         │  (回收)     ┌──────────┐
         │             │ running  │  ← 重启（仅 failed 状态可重启）
         │             └──────────┘
         │
         └── (异常：pid 未获取到) ──→ failed
```

### 状态值定义

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `starting` | window 已创建，命令已发送，等待进程启动 | 确认 pid → `running`；超时未获取到 pid → `failed` |
| `running` | 进程已确认启动，正在执行任务 | 进程退出 → `exited` 或 `failed` |
| `exited` | 进程正常退出（完成任务） | 收集输出 → 回收 window |
| `failed` | 进程异常退出或执行失败 | 重启 → `running`；放弃 → 回收 window |

### 合法状态转换

| 起始状态 | 目标状态 | 触发条件 |
|----------|----------|----------|
| `starting` | `running` | 成功获取到子进程 pid |
| `starting` | `failed` | 超时未获取到 pid 或 window 创建失败 |
| `running` | `exited` | 进程正常退出 |
| `running` | `failed` | 进程异常退出 |
| `failed` | `running` | 主控 Agent 决定重启，并成功启动新进程 |

> **不允许**的转换：`exited → running`（已正常完成的任务不应重启）、`running → starting`（不可回退）。

---

## 5. 读写规则

### 事件与对应操作

| 事件 | 状态文件操作 | 示例 |
|------|-------------|------|
| 创建 Agent | 新增条目，status=`"starting"`, pid=`null` | `jq '.agents["task-x"] = {...}'` |
| 确认 pid | 更新 pid 和 status=`"running"` | `jq '.agents["task-x"].pid = 1234 \| .agents["task-x"].status = "running"'` |
| 检测到正常退出 | status=`"exited"`, 记录 finished_at | `jq '.agents["task-x"].status = "exited" \| .agents["task-x"].finished_at = "..."'` |
| 检测到异常退出 | status=`"failed"`, 记录 finished_at | `jq '.agents["task-x"].status = "failed" \| .agents["task-x"].finished_at = "..."'` |
| 重启 Agent | status=`"running"`, 更新 pid, restart_count+1 | `jq '.agents["task-x"].restart_count += 1 \| .agents["task-x"].status = "running" \| .agents["task-x"].pid = 5678'` |
| 回收 Agent | 删除条目 | `jq 'del(.agents["task-x"])'` |
| 全部清理 | 删除状态文件 | `rm .tmux-agents.json` |

### 初始化

当状态文件不存在时，创建初始结构：

```bash
cat > .tmux-agents.json << 'EOF'
{
  "session": "openclaw-agents",
  "created_at": "2026-03-04T10:00:00Z",
  "agents": {}
}
EOF
```

> 如果状态文件已存在，说明之前有调度环境。应进入重连恢复流程，而非重新初始化。

### 名称分配

Agent 名称直接用作 `agents` 对象的 key。命名规则：

- 使用描述性名称，如 `task-refactor`、`task-test`、`fix-auth-bug`
- 名称必须唯一（作为 key 天然唯一）
- 建议使用小写字母、数字和连字符（`-`），避免空格和特殊字符
- 名称同时作为 tmux window 名称使用

### 原子性写入

使用 `jq` 更新状态文件时，必须先写入临时文件再重命名，避免写入中断导致文件损坏：

```bash
jq '<expression>' .tmux-agents.json > .tmux-agents.json.tmp \
  && mv .tmux-agents.json.tmp .tmux-agents.json
```

---

## 6. 状态修正规则

### 核心原则

> **状态文件是声明，tmux + pid 是事实。**
> 当声明与事实不一致时，以事实为准修正声明，绝不反过来操作。

### 不一致场景与修正策略

| 状态文件记录 | tmux/pid 事实 | 修正操作 |
|-------------|--------------|----------|
| status=`"running"` | pid 不存在 | 修正为 `"exited"` 或 `"failed"` |
| status=`"running"` | window 不存在 | 修正为 `"failed"` |
| status=`"starting"` | 进程已在运行 | 获取 pid，修正为 `"running"` |
| status=`"starting"` | window 不存在 | 修正为 `"failed"` |
| 条目不存在 | window 存在 | 新增条目，status=`"running"`（如果有子进程），否则标记调查 |
| 条目存在 | session 不存在 | 所有 `"running"` 条目修正为 `"failed"` |

### 判断 exited 还是 failed

进程退出后，需要区分是正常退出还是异常退出：

1. **检查退出码**（如果 pane 设置了 `remain-on-exit`）：
   - 退出码 `0` → `"exited"`
   - 非零退出码 → `"failed"`

2. **检查输出内容**：
   - 包含明确的完成/成功标志 → `"exited"`
   - 包含 error、crash、panic 等关键词 → `"failed"`

3. **默认策略**：
   - 无法判断时，保守标记为 `"failed"`，等待主控 Agent 人工确认

```bash
# 示例：检查进程退出后的状态修正
PANE_PID=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_pid}')
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)

if [ -z "$CHILD_PID" ]; then
  # 没有子进程 — 检查 pane 是否还活着
  DEAD=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_dead}' 2>/dev/null)
  if [ "$DEAD" = "1" ]; then
    echo "进程已退出（pane dead）"
  else
    echo "Shell 存活但无子进程 — Agent 已完成"
  fi
  # 读取最后输出判断 exited 还是 failed
  OUTPUT=$(tmux capture-pane -t openclaw-agents:task-refactor -p -S -20)
  # 根据 OUTPUT 内容决定状态...
fi
```
