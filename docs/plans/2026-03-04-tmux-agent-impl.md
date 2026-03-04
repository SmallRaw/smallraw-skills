# tmux-agent Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the tmux-agent skill for OpenClaw, enabling any AI CLI tool to orchestrate other AI CLI tools via tmux with tool-level persistence.

**Architecture:** Pure markdown skill (no scripts). Three knowledge files map to three architectural layers: tmux primitives, state protocol, lifecycle management. SKILL.md is the main entry point containing the core workflow and hard rules.

**Tech Stack:** Markdown, YAML frontmatter, JSON schema (for state protocol documentation)

**Design doc:** `docs/plans/2026-03-04-tmux-agent-design.md`

---

### Task 1: Create directory structure

**Files:**
- Create: `skills/tmux-agent/` (directory)
- Create: `skills/tmux-agent/knowledge/` (directory)

**Step 1: Create directories**

Run: `mkdir -p skills/tmux-agent/knowledge`

**Step 2: Verify**

Run: `ls -la skills/tmux-agent/`
Expected: empty directory with `knowledge/` subdirectory

---

### Task 2: Write SKILL.md

**Files:**
- Create: `skills/tmux-agent/SKILL.md`

**Reference:** Follow the same pattern as `skills/architect/SKILL.md` — YAML frontmatter + structured markdown body. This is the main file Agent reads when the skill is loaded.

**Step 1: Write SKILL.md**

Write `skills/tmux-agent/SKILL.md` with the following content:

```markdown
---
name: tmux-agent
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

# tmux-agent — 多 AI CLI 工具调度协议

> 通过 tmux 实现 AI Agent 对其他 AI CLI 工具的持久化调度。专为 OpenClaw 设计。

---

## 何时使用

- 当你需要将任务委派给另一个 AI CLI 工具（Claude Code、Gemini CLI、Codex 等）执行
- 当你需要并行运行多个工具实例处理不同任务
- 当你需要检查之前派出的工具的状态和结果
- 当你的 session 断开后需要恢复之前的调度状态

---

## 架构概览

三层模型，每层独立可用，上层依赖下层：

```
┌─────────────────────────────────────────┐
│  Layer 3: Lifecycle Management          │
│  健康检查 / 自动重启 / 资源回收           │
├─────────────────────────────────────────┤
│  Layer 2: Task State Protocol           │
│  .tmux-agents.json 状态持久化            │
├─────────────────────────────────────────┤
│  Layer 1: tmux Primitives               │
│  session / window / pane / send / read  │
└─────────────────────────────────────────┘
```

详细参考：
- Layer 1 → `knowledge/tmux-primitives.md`
- Layer 2 → `knowledge/state-protocol.md`
- Layer 3 → `knowledge/lifecycle-management.md`

---

## 核心工作流

### 1. 初始化调度环境

```bash
# 检查 tmux 是否可用
which tmux

# 创建 session（以项目名命名）
tmux new-session -d -s <project-name>

# 初始化状态文件
# 写入空的 .tmux-agents.json（schema 见 knowledge/state-protocol.md）
```

如果 `.tmux-agents.json` 已存在，进入**重连恢复流程**（见第 6 步）。

### 2. 派发任务

严格按此顺序执行：

```
创建 window → 写入状态文件 → 发送命令 → 确认进程启动 → 更新 pid
```

```bash
# 1. 创建 window
tmux new-window -t <session>:<window-name>

# 2. 写入状态文件（status: "running", pid: null）

# 3. 发送命令
tmux send-keys -t <session>:<window-name> '<command>' Enter

# 4. 获取 pid
tmux list-panes -t <session>:<window-name> -F '#{pane_pid}'

# 5. 更新状态文件中的 pid
```

### 3. 检查状态

```bash
# 检查特定 agent 的进程是否存活
tmux list-panes -t <session>:<window-name> -F '#{pane_pid} #{pane_dead}'

# 如果 pane_dead 为 1 或 pid 进程不存在 → 工具已退出
ps -p <pid> > /dev/null 2>&1 || echo "process exited"
```

读取 `.tmux-agents.json`，对每个 `running` 状态的 agent 执行上述检查，修正状态。

### 4. 收集结果

```bash
# 读取工具的终端输出（最后 N 行）
tmux capture-pane -t <session>:<window-name> -p -S -<N>
```

对于输出量大的工具，分段读取：
```bash
# 读取指定范围
tmux capture-pane -t <session>:<window-name> -p -S <start> -E <end>
```

### 5. 生命周期管理

详细规则见 `knowledge/lifecycle-management.md`，核心操作：

**重启失败的工具：**
```bash
# 在同一 window 重新发送命令
tmux send-keys -t <session>:<window-name> '<command>' Enter
# 更新状态文件：status → "restarted"，记录 restart_count
```

**回收已完成的工具：**
```bash
# 确认结果已读取后
tmux kill-window -t <session>:<window-name>
# 从状态文件中删除该 agent 条目
```

**清理整个环境：**
```bash
tmux kill-session -t <session>
rm .tmux-agents.json
```

### 6. 重连恢复

主控 Agent 断开后重连时执行：

```
读状态文件 → 检查 session 存在 → 逐个验证 pid → 修正状态 → 报告
```

```bash
# 1. 读取 .tmux-agents.json

# 2. 检查 session 是否存在
tmux has-session -t <session> 2>/dev/null
# 如果不存在 → session 已丢失，需要重建

# 3. 逐个验证 agent
for agent in agents:
  tmux list-panes -t <session>:<window> -F '#{pane_pid} #{pane_dead}'
  # pane_dead=1 或 pid 不存在 → 标记为 completed/failed
  # 进程仍在运行 → 保持 running

# 4. 更新状态文件

# 5. 向主控报告当前状态
```

---

## 规则

### 禁止规则

- 禁止在没有更新 `.tmux-agents.json` 的情况下创建或销毁 window
- 禁止假设工具状态，必须通过 pid 检测确认
- 禁止删除 status 为 `failed` 的 window，除非主控明确要求

### 过程规则

- 派发任务：创建 window → 记录状态 → 发送命令 → 确认进程启动 → 更新 pid
- 重连恢复：读状态文件 → 检查 session 存在 → 逐个验证 pid → 修正状态 → 报告
- 状态修正：状态文件是"声明"，tmux + pid 是"事实"。不一致时以事实为准。

### 检查清单

操作前检查：
- [ ] tmux 是否已安装（`which tmux`）
- [ ] session 是否已存在（`tmux has-session`）
- [ ] `.tmux-agents.json` 是否可读写

---

## 知识库文件

| 文件 | 用途 |
|------|------|
| `knowledge/tmux-primitives.md` | tmux 命令原语参考（所有需要的命令及其参数、输出格式、错误处理） |
| `knowledge/state-protocol.md` | `.tmux-agents.json` 状态文件完整协议（JSON Schema、读写规则、状态修正） |
| `knowledge/lifecycle-management.md` | 工具实例生命周期管理（健康检查、重启、回收、异常恢复） |
```

**Step 2: Verify content**

Run: `head -5 skills/tmux-agent/SKILL.md`
Expected: YAML frontmatter starting with `---`

**Step 3: Commit**

```bash
git add skills/tmux-agent/SKILL.md
git commit -m "feat(tmux-agent): add SKILL.md with core workflow and rules"
```

---

### Task 3: Write knowledge/tmux-primitives.md

**Files:**
- Create: `skills/tmux-agent/knowledge/tmux-primitives.md`

**Step 1: Write tmux-primitives.md**

Write `skills/tmux-agent/knowledge/tmux-primitives.md` with the following content:

```markdown
# tmux 原语操作参考

Agent 通过 bash 直接调用的 tmux 命令子集。只收录调度 AI CLI 工具所需的命令。

---

## Session 管理

### 创建 session

```bash
tmux new-session -d -s <session-name>
```

- `-d`：后台创建，不自动 attach
- `-s`：指定 session 名称
- 约定：session 名用项目名（如 `openclaw`）
- 如果 session 已存在会报错：`duplicate session: <name>`

### 检查 session 是否存在

```bash
tmux has-session -t <session-name> 2>/dev/null && echo "exists" || echo "not found"
```

- 返回 exit code：0 = 存在，1 = 不存在
- 重连恢复时第一步调用

### 列出所有 session

```bash
tmux list-sessions -F '#{session_name} #{session_windows} #{session_created}'
```

- `#{session_name}`：session 名
- `#{session_windows}`：window 数量
- `#{session_created}`：创建时间（Unix 时间戳）

### 销毁 session

```bash
tmux kill-session -t <session-name>
```

- 会同时销毁 session 下所有 window 和 pane
- 所有工具完成且结果已收集后调用

---

## Window 管理

### 创建 window

```bash
tmux new-window -t <session-name> -n <window-name>
```

- `-t`：目标 session
- `-n`：window 名称
- 约定：window 名用 `agent-<id>` 格式（如 `agent-1`、`agent-2`）
- 每个工具实例对应一个 window

### 创建 window 并指定工作目录

```bash
tmux new-window -t <session-name> -n <window-name> -c <directory>
```

- `-c`：指定 window 的初始工作目录
- 用于让工具在特定项目目录下运行

### 列出所有 window

```bash
tmux list-windows -t <session-name> -F '#{window_name} #{window_index}'
```

- `#{window_name}`：window 名
- `#{window_index}`：window 索引号

### 销毁 window

```bash
tmux kill-window -t <session-name>:<window-name>
```

- 会终止 window 内的进程
- 销毁前确保已收集输出

---

## 命令交互

### 发送命令

```bash
tmux send-keys -t <session-name>:<window-name> '<command>' Enter
```

- `Enter`：模拟回车键执行命令
- 命令中的单引号需要转义或使用双引号包裹
- 这是 fire-and-forget 的核心操作

### 发送特殊键

```bash
# Ctrl+C（中断进程）
tmux send-keys -t <session-name>:<window-name> C-c

# Ctrl+D（EOF/退出）
tmux send-keys -t <session-name>:<window-name> C-d

# 多次回车（确认提示）
tmux send-keys -t <session-name>:<window-name> Enter
```

### 发送多行命令

```bash
tmux send-keys -t <session-name>:<window-name> 'line1' Enter
tmux send-keys -t <session-name>:<window-name> 'line2' Enter
```

逐行发送，每行一个 `send-keys` 调用。

---

## 输出读取

### 读取当前 pane 输出

```bash
tmux capture-pane -t <session-name>:<window-name> -p
```

- `-p`：输出到 stdout（而非 tmux buffer）
- 默认读取可见区域

### 读取最后 N 行

```bash
tmux capture-pane -t <session-name>:<window-name> -p -S -<N>
```

- `-S -500`：从倒数第 500 行开始读取
- 适合读取长输出的工具结果

### 读取指定范围

```bash
tmux capture-pane -t <session-name>:<window-name> -p -S <start> -E <end>
```

- `-S 0 -E 100`：读取第 0 到 100 行
- 用于分段读取大量输出

### 读取完整历史（含滚动缓冲区）

```bash
tmux capture-pane -t <session-name>:<window-name> -p -S -
```

- `-S -`：从历史最开始读取
- 注意：输出可能非常大，优先使用范围读取

---

## 进程检测

### 获取 pane 内进程 PID

```bash
tmux list-panes -t <session-name>:<window-name> -F '#{pane_pid}'
```

- 返回 pane 内 shell 的 PID
- 注意：这是 shell 的 PID，不是工具进程的 PID

### 获取 pane 内实际运行的子进程

```bash
# 获取 pane shell 的 PID
PANE_PID=$(tmux list-panes -t <session-name>:<window-name> -F '#{pane_pid}')

# 查找其子进程（即实际运行的工具）
pgrep -P $PANE_PID
```

### 检查进程是否存活

```bash
ps -p <pid> > /dev/null 2>&1 && echo "alive" || echo "dead"
```

### 检查 pane 是否已"死亡"

```bash
tmux list-panes -t <session-name>:<window-name> -F '#{pane_dead}'
```

- `0`：pane 内进程仍在运行
- `1`：pane 内进程已退出
- 需要 tmux 配置 `set -g remain-on-exit on` 才能在进程退出后保留 pane

---

## 环境信息

### 获取当前 session 信息

```bash
tmux display-message -t <session-name> -p '#{session_name} windows=#{session_windows}'
```

### 获取 window 信息

```bash
tmux display-message -t <session-name>:<window-name> -p '#{window_name} panes=#{window_panes}'
```
```

**Step 2: Commit**

```bash
git add skills/tmux-agent/knowledge/tmux-primitives.md
git commit -m "feat(tmux-agent): add tmux primitives reference"
```

---

### Task 4: Write knowledge/state-protocol.md

**Files:**
- Create: `skills/tmux-agent/knowledge/state-protocol.md`

**Step 1: Write state-protocol.md**

Write `skills/tmux-agent/knowledge/state-protocol.md` with the following content:

```markdown
# 状态文件协议

`.tmux-agents.json` 是 tmux-agent 的持久化状态文件，记录所有调度的工具实例信息。

---

## 文件位置

- 路径：项目根目录下 `.tmux-agents.json`
- 必须加入 `.gitignore`（运行时状态，不应提交）

---

## JSON Schema

```json
{
  "session": "string (required) — tmux session 名称",
  "created_at": "string (required) — ISO 8601 时间戳，session 创建时间",
  "agents": [
    {
      "id": "string (required) — agent 唯一标识，格式：agent-<number>",
      "window": "string (required) — tmux window 名称，与 id 一致",
      "tool": "string (required) — 工具名称（如 claude、gemini、codex）",
      "command": "string (required) — 发送给工具的完整命令",
      "task": "string (required) — 任务的人类可读描述",
      "status": "string (required) — 枚举：running | completed | failed | restarted",
      "pid": "number | null (required) — pane 内 shell 的 PID，启动前为 null",
      "started_at": "string (required) — ISO 8601 时间戳",
      "finished_at": "string | null (required) — ISO 8601 时间戳，未完成为 null",
      "restart_count": "number (optional) — 重启次数，默认 0",
      "last_output_preview": "string (optional) — 最近一次 capture-pane 的摘要"
    }
  ]
}
```

---

## 完整示例

```json
{
  "session": "openclaw",
  "created_at": "2026-03-04T10:00:00Z",
  "agents": [
    {
      "id": "agent-1",
      "window": "agent-1",
      "tool": "gemini",
      "command": "gemini chat -p '重构 auth 模块'",
      "task": "重构 auth 模块",
      "status": "running",
      "pid": 12345,
      "started_at": "2026-03-04T10:01:00Z",
      "finished_at": null
    },
    {
      "id": "agent-2",
      "window": "agent-2",
      "tool": "claude",
      "command": "claude -p '写 auth 模块的单元测试'",
      "task": "写单元测试",
      "status": "completed",
      "pid": 12346,
      "started_at": "2026-03-04T10:02:00Z",
      "finished_at": "2026-03-04T10:15:00Z"
    },
    {
      "id": "agent-3",
      "window": "agent-3",
      "tool": "codex",
      "command": "codex -q '修复 sidebar CSS 溢出'",
      "task": "修 CSS bug",
      "status": "failed",
      "pid": 12347,
      "started_at": "2026-03-04T10:03:00Z",
      "finished_at": "2026-03-04T10:05:00Z",
      "restart_count": 0
    }
  ]
}
```

---

## 状态流转

```
              ┌──────────┐
              │ running  │
              └────┬─────┘
                   │ 进程退出
          ┌────────┴────────┐
          ▼                 ▼
   ┌────────────┐    ┌──────────┐
   │ completed  │    │  failed  │
   └────────────┘    └────┬─────┘
                          │ 主控决定重启
                          ▼
                   ┌────────────┐
                   │ restarted  │──→ 视为新的 running
                   └────────────┘
```

- `running`：工具正在执行
- `completed`：工具正常退出（进程不存在且无错误信号）
- `failed`：工具异常退出
- `restarted`：工具被主控重启（restart_count +1），之后视为 running

---

## 读写规则

### 写入时机

| 事件 | 操作 |
|------|------|
| 创建新 agent | 追加 agent 条目（status: running, pid: null） |
| 确认进程启动 | 更新 pid 字段 |
| 检查发现进程退出 | 更新 status 为 completed/failed，写入 finished_at |
| 重启工具 | 更新 status 为 restarted，restart_count +1，重置 pid |
| 回收 window | 从 agents 数组中删除该条目 |
| 清理整个环境 | 删除 `.tmux-agents.json` 文件 |

### 初始化

文件不存在时，创建：

```json
{
  "session": "<session-name>",
  "created_at": "<ISO-8601-now>",
  "agents": []
}
```

### ID 分配

- 读取现有 agents 数组
- 找到最大的 `agent-<N>` 中的 N
- 新 agent 的 id 为 `agent-<N+1>`
- 如果数组为空，从 `agent-1` 开始

---

## 状态修正规则

**核心原则：状态文件是"声明"，tmux + pid 是"事实"。**

重连或检查时，必须以事实修正声明：

| 状态文件说 | tmux 实际情况 | 修正动作 |
|-----------|-------------|---------|
| running | pid 存在 | 无需修正 |
| running | pid 不存在 | → completed 或 failed |
| running | window 不存在 | → failed |
| completed | pid 存在 | 异常！调查后修正 |
| 条目存在 | session 不存在 | 所有 agent → failed |

判断 completed vs failed：
- 如果能从 tmux 获取 exit code → 按 exit code 判断
- 如果无法获取 → 默认标记为 completed，由主控读取输出后确认
```

**Step 2: Commit**

```bash
git add skills/tmux-agent/knowledge/state-protocol.md
git commit -m "feat(tmux-agent): add state protocol for .tmux-agents.json"
```

---

### Task 5: Write knowledge/lifecycle-management.md

**Files:**
- Create: `skills/tmux-agent/knowledge/lifecycle-management.md`

**Step 1: Write lifecycle-management.md**

Write `skills/tmux-agent/knowledge/lifecycle-management.md` with the following content:

```markdown
# 工具生命周期管理

工具实例从创建到销毁的全生命周期规则。

---

## 生命周期概览

```
创建 window
    │
    ▼
发送命令 ──→ 运行中 ──→ 进程退出
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
              正常完成           异常退出
                  │                 │
                  ▼                 ▼
            保留 window         保留现场
           （供读取输出）      （供排查问题）
                  │                 │
                  │            ┌────┴────┐
                  │            ▼         ▼
                  │        主控重启    不重启
                  │            │         │
                  ▼            ▼         ▼
            回收 window    运行中     回收 window
```

---

## 健康检查

### 方法 1：pane_dead 标志（推荐）

```bash
tmux list-panes -t <session>:<window> -F '#{pane_dead}'
```

- `0`：进程运行中
- `1`：进程已退出
- 需要 tmux 配置 `remain-on-exit on`

### 方法 2：pid 存在性检查

```bash
PANE_PID=$(tmux list-panes -t <session>:<window> -F '#{pane_pid}')
ps -p $PANE_PID > /dev/null 2>&1
```

- exit code 0：进程存活
- exit code 非 0：进程已退出

### 方法 3：子进程检查

```bash
PANE_PID=$(tmux list-panes -t <session>:<window> -F '#{pane_pid}')
CHILD_PID=$(pgrep -P $PANE_PID)
```

- 如果 shell 存活但无子进程 → 工具已退出，shell 回到提示符
- 如果 shell 和子进程都存活 → 工具仍在运行

### 检查进程状态（排除 zombie）

```bash
ps -o stat= -p <pid>
```

- `Z`：zombie 进程（已退出但未被回收）→ 视为已退出
- `T`：stopped 进程 → 可能卡住了

---

## 完成判定

工具被视为"已完成"的条件（满足任一）：

1. `#{pane_dead}` 为 1
2. pane shell 的 PID 不存在
3. pane shell 存活但无子进程（工具进程已退出）

完成 ≠ 成功。需要主控读取输出后判断任务是否真正完成。

---

## 重启策略

### 何时重启

- 工具异常退出（status: failed）
- 主控明确要求重启

### 重启方法

```bash
# 如果 pane 还在（remain-on-exit on）
tmux respawn-pane -t <session>:<window> -k

# 或者直接在现有 shell 中重新发送命令
tmux send-keys -t <session>:<window> '<command>' Enter
```

### 重启后更新状态

```json
{
  "status": "restarted",
  "restart_count": 1,
  "pid": null
}
```

然后获取新 pid 并更新。

### 重启上限

建议：同一 agent 最多重启 3 次。超过后标记为 failed，由主控决定后续处理。

---

## 回收策略

### 单个 agent 回收

条件：status 为 completed 且结果已读取

```bash
tmux kill-window -t <session>:<window>
```

然后从 `.tmux-agents.json` 的 agents 数组中删除该条目。

### 全环境回收

条件：所有 agents 都已 completed/failed 且结果已处理

```bash
tmux kill-session -t <session>
rm .tmux-agents.json
```

### 不回收的情况

- status 为 `failed` 且主控未确认 → 保留现场供排查
- status 为 `running` → 不能回收正在运行的工具

---

## 异常场景处理

### 场景 1：tmux server 崩溃

**现象：** `tmux has-session` 报错 `no server running`

**处理：**
1. `.tmux-agents.json` 仍然存在
2. 重新创建 session：`tmux new-session -d -s <session>`
3. 将所有 `running` 状态的 agent 标记为 `failed`
4. 主控决定是否重新派发这些任务

### 场景 2：状态文件损坏或丢失

**现象：** `.tmux-agents.json` 无法解析或不存在，但 tmux session 还在

**处理：**
1. 列出 session 下所有 window：`tmux list-windows -t <session> -F '#{window_name}'`
2. 对每个 window 检查进程状态
3. 重建 `.tmux-agents.json`（tool 和 task 字段设为 "unknown"）

### 场景 3：window 存在但状态文件中无对应条目

**处理：** 该 window 可能是手动创建的或状态文件被部分修改。
- 检查其进程状态
- 补充到状态文件中（tool: "unknown", task: "unknown"）

### 场景 4：状态文件有条目但 window 不存在

**处理：** window 可能被手动关闭。
- 将该 agent 标记为 `failed`
- 保留条目供主控确认
```

**Step 2: Commit**

```bash
git add skills/tmux-agent/knowledge/lifecycle-management.md
git commit -m "feat(tmux-agent): add lifecycle management rules"
```

---

### Task 6: Write README.md

**Files:**
- Create: `skills/tmux-agent/README.md`

**Reference:** Follow the same pattern as `skills/architect/README.md`.

**Step 1: Write README.md**

Write `skills/tmux-agent/README.md` with the following content:

```markdown
# tmux-agent Skill

> 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作

---

## 核心理念

**让任意 AI CLI 工具成为你的 Agent。** 通过 tmux 的 session/window 机制，实现工具级持久化调度——工具在独立窗口运行，主控断开后仍然保持，重连后可恢复状态。

专为 [OpenClaw](https://github.com/openclaw/openclaw) 设计。

---

## 前置条件

- tmux 已安装（`brew install tmux` 或 `apt install tmux`）

---

## 工作原理

```
┌─────────────────────────────────────────────┐
│  主控 Agent (Claude Code / Gemini / Codex)   │
│                                             │
│  读取 SKILL.md → 学会 tmux 调度协议          │
│  创建 tmux session → 派发任务到各 window      │
│  断开/重连 → 通过状态文件恢复                  │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
  tmux window  tmux window  tmux window
  ┌────┴───┐  ┌────┴───┐  ┌────┴───┐
  │Gemini  │  │Claude  │  │Codex   │
  │CLI     │  │Code    │  │        │
  │重构auth │  │写测试   │  │修CSS   │
  └────────┘  └────────┘  └────────┘
```

---

## 文件结构

```
tmux-agent/
├── SKILL.md                        # 主入口：工作流 + 规则
├── README.md                       # 本文件
└── knowledge/
    ├── tmux-primitives.md          # tmux 命令参考
    ├── lifecycle-management.md     # 生命周期管理规则
    └── state-protocol.md           # .tmux-agents.json 协议
```

---

## 三层架构

| 层 | 职责 | 知识库文件 |
|----|------|-----------|
| Layer 1 | tmux 原语操作 | `knowledge/tmux-primitives.md` |
| Layer 2 | 状态持久化 | `knowledge/state-protocol.md` |
| Layer 3 | 生命周期管理 | `knowledge/lifecycle-management.md` |

---

## 核心工作流

1. **初始化** — 创建 tmux session + 状态文件
2. **派发** — 创建 window → 写状态 → 发送命令 → 记录 pid
3. **检查** — 验证 pid 存活 → 修正状态
4. **收集** — capture-pane 读取输出
5. **管理** — 重启失败工具 / 回收已完成工具
6. **恢复** — 断开后重连，以 tmux 实际状态修正状态文件

---

## 设计来源

这个 Skill 为 [OpenClaw](https://github.com/openclaw/openclaw) 项目设计，解决 AI Agent 调度多个 CLI 工具协作的持久化问题。

---

## License

MIT
```

**Step 2: Commit**

```bash
git add skills/tmux-agent/README.md
git commit -m "feat(tmux-agent): add README"
```

---

### Task 7: Update root README.md

**Files:**
- Modify: `README.md:43-47` (Available Skills table)
- Modify: `README.md:88-111` (Skills Overview section)

**Step 1: Add to Available Skills table**

In `README.md`, after the excel-analyst row in the table (line 47), add:

```markdown
| [tmux-agent](skills/tmux-agent/) | 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作 | ✅ Ready |
```

**Step 2: Add Skills Overview section**

After the `/excel-analyst` overview section (around line 111), add:

```markdown

### tmux-agent

**多 AI CLI 工具调度协议** - 通过 tmux 实现持久化的多 Agent 协作。

核心理念：**让任意 AI CLI 工具成为你的 Agent。**

Features:
- 三层架构：tmux 原语 → 状态持久化 → 生命周期管理
- 工具级持久化：session + 任务状态 + 健康检查/重启/回收
- Fire-and-forget：派发任务后异步收集结果
- 断线恢复：主控断开后通过状态文件 + pid 验证恢复调度
```

**Step 3: Add installation commands**

In the Installation section (around line 16), add:

```bash
/plugin install tmux-agent@smallraw-skills
```

And in the manual install section add:

```bash
cp -r /tmp/smallraw-skills/skills/tmux-agent ~/.claude/skills/
```

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add tmux-agent to root README"
```

---

### Task 8: Final verification

**Step 1: Verify all files exist**

Run: `find skills/tmux-agent -type f | sort`

Expected:
```
skills/tmux-agent/README.md
skills/tmux-agent/SKILL.md
skills/tmux-agent/knowledge/lifecycle-management.md
skills/tmux-agent/knowledge/state-protocol.md
skills/tmux-agent/knowledge/tmux-primitives.md
```

**Step 2: Verify SKILL.md frontmatter is valid**

Run: `head -12 skills/tmux-agent/SKILL.md`

Expected: Valid YAML frontmatter with `name: tmux-agent`

**Step 3: Verify no broken internal references**

Check that SKILL.md references to `knowledge/*.md` files match actual filenames.

**Step 4: Check overall git status**

Run: `git log --oneline -5`

Expected: 5 commits for this feature (SKILL.md, 3 knowledge files, README, root README update)
