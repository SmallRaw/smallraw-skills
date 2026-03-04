# tmux 原语操作参考

> 本文档仅收录 AI CLI 工具调度所需的 tmux 命令，不是 tmux 完整手册。
> 所有命令均为 CLI 模式（`tmux <command>`），不涉及 tmux 内部快捷键。

---

## 1. Session 管理

Session 是 tmux 的顶层容器。一个调度环境对应一个 session。

### 创建 session（后台模式）

```bash
tmux new-session -d -s <session-name>
```

- `-d`：detached 模式，不附加终端
- `-s`：指定 session 名称

```bash
# 示例：创建调度 session
tmux new-session -d -s openclaw-agents
```

### 检查 session 是否存在

```bash
tmux has-session -t <session-name> 2>/dev/null
echo $?  # 0 = 存在, 1 = 不存在
```

```bash
# 示例：条件判断
tmux has-session -t openclaw-agents 2>/dev/null && echo "存在" || echo "不存在"
```

### 销毁 session

```bash
tmux kill-session -t <session-name>
```

> 销毁 session 会同时销毁其下所有 window 和 pane。用于全部任务完成后的最终清理。

```bash
# 示例：清理调度环境
tmux kill-session -t openclaw-agents
```

### 列出所有 session

```bash
tmux list-sessions -F '#{session_name} #{session_created}'
```

- `-F`：自定义输出格式，使用 `#{}` 变量

```bash
# 示例：仅列出 session 名称
tmux list-sessions -F '#{session_name}'
# 输出示例：
# openclaw-agents
# my-other-session
```

---

## 2. Window 管理

每个 Agent 占用一个独立的 window。window 名称是该 Agent 的标识符。

### 创建 window

```bash
tmux new-window -t <session-name> -n <window-name>
```

- `-t`：目标 session
- `-n`：window 名称（用作 Agent 标识）

```bash
# 示例：为重构任务创建 window
tmux new-window -t openclaw-agents -n "task-refactor"
```

### 创建 window（指定工作目录）

```bash
tmux new-window -t <session-name> -n <window-name> -c <working-directory>
```

- `-c`：window 启动时的工作目录

```bash
# 示例：在项目子目录中创建 window
tmux new-window -t openclaw-agents -n "task-frontend" -c "/home/user/project/frontend"
```

### 销毁 window

```bash
tmux kill-window -t <session-name>:<window-name>
```

> 使用 `session:window` 格式精确定位。

```bash
# 示例：销毁指定 Agent 的 window
tmux kill-window -t openclaw-agents:task-refactor
```

### 列出 session 下所有 window

```bash
tmux list-windows -t <session-name> -F '<format>'
```

常用格式变量：

| 变量 | 含义 |
|------|------|
| `#{window_name}` | window 名称 |
| `#{window_index}` | window 编号 |
| `#{window_active}` | 是否为当前活动 window（1/0） |
| `#{pane_pid}` | pane 的 shell 进程 PID |

```bash
# 示例：列出所有 window 名称和编号
tmux list-windows -t openclaw-agents -F '#{window_index} #{window_name}'
# 输出示例：
# 0 bash
# 1 task-refactor
# 2 task-test
```

---

## 3. 命令交互

通过 `send-keys` 向指定 window 的 pane 发送按键序列，等同于在终端中输入。

### 发送命令

```bash
tmux send-keys -t <session>:<window> '<command>' Enter
```

- 命令字符串用引号包裹
- `Enter` 是 tmux 的特殊按键名，表示回车

```bash
# 示例：在指定 window 中启动 claude-code
tmux send-keys -t openclaw-agents:task-refactor "claude-code --task '重构 utils 模块'" Enter
```

### 特殊按键

| 按键 | 含义 | 典型用途 |
|------|------|----------|
| `Enter` | 回车 | 执行命令 |
| `C-c` | Ctrl+C | 中断正在运行的进程 |
| `C-d` | Ctrl+D | 发送 EOF，关闭 shell |
| `C-l` | Ctrl+L | 清屏 |

```bash
# 示例：中断正在运行的 Agent
tmux send-keys -t openclaw-agents:task-refactor C-c

# 示例：关闭 window 中的 shell
tmux send-keys -t openclaw-agents:task-refactor C-d
```

### 多行命令

对于需要多行输入的场景，逐行发送：

```bash
# 示例：发送多行脚本
tmux send-keys -t openclaw-agents:task-refactor 'cd /project' Enter
tmux send-keys -t openclaw-agents:task-refactor 'export DEBUG=1' Enter
tmux send-keys -t openclaw-agents:task-refactor 'claude-code --task "修复 bug #42"' Enter
```

> **注意**：每次 `send-keys` 后加 `Enter` 才会执行。不加 `Enter` 只是输入文本但不提交。

---

## 4. 输出读取

使用 `capture-pane` 从 pane 的输出缓冲区中读取内容。

### 读取当前可见内容（默认）

```bash
tmux capture-pane -t <session>:<window> -p
```

- `-p`：将捕获内容输出到 stdout（而非 tmux buffer）

```bash
# 示例：读取 task-refactor 的当前屏幕内容
tmux capture-pane -t openclaw-agents:task-refactor -p
```

### 读取最后 N 行

```bash
tmux capture-pane -t <session>:<window> -p -S -<N>
```

- `-S -<N>`：从倒数第 N 行开始捕获（负数表示从底部往上）

```bash
# 示例：读取最后 50 行
tmux capture-pane -t openclaw-agents:task-refactor -p -S -50
```

### 读取指定范围

```bash
tmux capture-pane -t <session>:<window> -p -S <start> -E <end>
```

- `-S`：起始行号（负数从底部算）
- `-E`：结束行号（负数从底部算）

```bash
# 示例：读取从倒数第 30 行到倒数第 10 行
tmux capture-pane -t openclaw-agents:task-refactor -p -S -30 -E -10
```

### 读取全部历史（scrollback buffer）

```bash
tmux capture-pane -t <session>:<window> -p -S -
```

- `-S -`：从 scrollback buffer 的最开头开始

```bash
# 示例：读取完整输出历史
tmux capture-pane -t openclaw-agents:task-refactor -p -S -
```

> **注意**：scrollback buffer 大小受 tmux 配置 `history-limit` 限制（默认 2000 行）。如果需要更大的缓冲区，可在创建 session 前设置：
> ```bash
> tmux set-option -g history-limit 10000
> ```

---

## 5. 进程检测

判断 Agent 进程是否存活是状态管理的核心。需要组合多种检测方式。

### 获取 pane 的 shell PID

```bash
tmux list-panes -t <session>:<window> -F '#{pane_pid}'
```

输出 pane 中运行的 shell 进程 PID。这是 shell 本身的 PID，不是 Agent 进程的 PID。

```bash
# 示例
PANE_PID=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_pid}')
echo "Shell PID: $PANE_PID"
# 输出示例：
# Shell PID: 12345
```

### 查找子进程（Agent 的实际 PID）

使用 `pgrep -P` 查找 shell 的子进程（跨平台兼容，macOS 和 Linux 均可用）：

```bash
pgrep -P <pane_pid>
```

```bash
# 示例：获取 Agent 的实际进程 PID
PANE_PID=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_pid}')
CHILD_PID=$(pgrep -P "$PANE_PID" | head -1)
echo "Agent PID: $CHILD_PID"
# 输出示例：
# Agent PID: 12346
```

> **注意**：使用 `pgrep -P` 而非 `ps --ppid`。后者在 macOS 上不可用。

### 检查进程是否存活

```bash
ps -p <pid> > /dev/null 2>&1
echo $?  # 0 = 存活, 1 = 不存在
```

```bash
# 示例：检查 Agent 是否还在运行
PID=12346
if ps -p "$PID" > /dev/null 2>&1; then
  echo "Agent 运行中"
else
  echo "Agent 已退出"
fi
```

### 检查 pane 是否已终止（需要 remain-on-exit）

如果设置了 `remain-on-exit` 选项，pane 在进程退出后不会自动关闭，可通过 `pane_dead` 标志检测：

```bash
# 先启用 remain-on-exit（建议在创建 window 后设置）
tmux set-option -t <session>:<window> remain-on-exit on

# 检查 pane 是否已终止
tmux list-panes -t <session>:<window> -F '#{pane_dead}'
# 输出：0 = 活跃, 1 = 已终止
```

```bash
# 示例：完整检测流程
tmux set-option -t openclaw-agents:task-refactor remain-on-exit on

DEAD=$(tmux list-panes -t openclaw-agents:task-refactor -F '#{pane_dead}')
if [ "$DEAD" = "1" ]; then
  echo "pane 中的进程已退出"
else
  echo "pane 中的进程仍在运行"
fi
```

### 检测僵尸进程

```bash
ps -p <pid> -o stat=
```

- 输出 `Z` 或 `Z+` 表示僵尸进程

```bash
# 示例：检查是否为僵尸进程
STAT=$(ps -p "$PID" -o stat= 2>/dev/null)
if [ "$STAT" = "Z" ] || [ "$STAT" = "Z+" ]; then
  echo "僵尸进程"
fi
```

---

## 6. 环境信息

使用 `display-message` 获取 tmux 内部变量的值。

### 获取 session 和 window 信息

```bash
tmux display-message -t <session>:<window> -p '<format>'
```

- `-p`：将结果输出到 stdout
- 支持所有 `#{}` 格式变量

```bash
# 示例：获取 pane PID
tmux display-message -t openclaw-agents:task-refactor -p '#{pane_pid}'
# 输出示例：12345

# 示例：获取 session 名称
tmux display-message -t openclaw-agents -p '#{session_name}'
# 输出示例：openclaw-agents

# 示例：获取 window 名称
tmux display-message -t openclaw-agents:task-refactor -p '#{window_name}'
# 输出示例：task-refactor

# 示例：获取多个属性（组合格式）
tmux display-message -t openclaw-agents:task-refactor -p '#{pane_pid} #{pane_dead} #{window_name}'
# 输出示例：12345 0 task-refactor
```

### 常用格式变量速查表

| 变量 | 含义 | 示例值 |
|------|------|--------|
| `#{session_name}` | session 名称 | `openclaw-agents` |
| `#{window_name}` | window 名称 | `task-refactor` |
| `#{window_index}` | window 编号 | `1` |
| `#{pane_pid}` | pane shell 的 PID | `12345` |
| `#{pane_dead}` | pane 是否已终止 | `0` 或 `1` |
| `#{pane_current_command}` | pane 中正在运行的命令 | `claude-code` |
| `#{session_created}` | session 创建时间戳 | `1709539200` |
