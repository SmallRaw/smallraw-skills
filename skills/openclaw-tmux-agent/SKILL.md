---
name: openclaw-tmux-agent
description: 当需要将子任务委派给其他 AI CLI 工具（claude-code、opencode、gemini-cli、codex）、并行运行多个实例、检查任务状态或断线重连恢复时触发。
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: false
disable-model-invocation: false
---

# openclaw-tmux-agent — 多 AI CLI 工具调度协议

> 通过 tmux session/window 持久化调度多个 AI CLI 工具实例，实现多 Agent 并行协作与断线重连。

## 核心规则

1. **状态文件是声明，tmux + pid 是事实** — 不一致时以事实为准修正声明，绝不反过来
2. **任何 window 操作必须同步状态文件** — new-window / kill-window 前后都要更新 `.tmux-agents.json`
3. **禁止不经 pid 验证假定状态** — 必须 `ps -p <pid>` 确认进程存活，不可仅看状态文件
4. **禁止自动删除 failed window** — 仅更新状态为 `"failed"`，由主控 Agent 决定重启或放弃
5. **派发严格五步不可跳步** — 创建 window → 写状态 → 发命令 → 确认 pid → 更新状态
6. **重连严格五步** — 读状态 → 检查 session → 验证 pid → 修正状态 → 报告

## Gotchas

1. **TUI 文本和 Enter 必须分离发送** — AI CLI 工具会把快速的 "文本+Enter" 当成粘贴。必须 `send-keys -l -- "text" && sleep 0.1 && send-keys Enter`
2. **PID 可被系统复用** — 进程退出后 PID 可能被分配给无关进程，仅凭 `ps -p` 不够。组合 `pgrep -P <pane_pid>` 确认子进程归属
3. **僵尸进程让 `ps -p` 骗你** — 僵尸状态下 `ps -p` 仍返回 0。必须额外检查 `ps -p <pid> -o stat=`，输出 `Z` 或 `Z+` 即僵尸
4. **macOS 没有 `ps --ppid`** — 查子进程必须用 `pgrep -P`，`ps --ppid` 仅 Linux 可用
5. **`remain-on-exit` 不预设则 pane 自动关闭** — 进程退出后 pane 消失，丢失所有输出。创建 window 后立即 `tmux set-option -t session:window remain-on-exit on`
6. **jq 直接重定向同一文件会截断** — `jq '...' file > file` 在写入前截断源文件。必须写临时文件再 `mv`：`jq '...' f.json > f.json.tmp && mv f.json.tmp f.json`
7. **scrollback 默认仅 2000 行** — `capture-pane -S -` 受 `history-limit` 限制，长任务输出会被截断。需要时提前 `tmux set-option -g history-limit 10000`
8. **exited 的 Agent 不可重启** — 已正常完成的任务应创建新 Agent，仅 `failed` 状态允许重启（最多 3 次）

## 工作流速查

```
初始化 → 派发任务 → 检查状态 → 收集结果 → 生命周期管理 → 重连恢复
```

每步的详细流程、命令参数、异常场景处理见 knowledge/ 目录。

## 知识库索引（按需加载）

| 文件 | 何时读取 |
|------|----------|
| `knowledge/tmux-primitives.md` | 需要 tmux 命令的具体参数和用法时 |
| `knowledge/state-protocol.md` | 需要读写 `.tmux-agents.json` 的 schema 和规则时 |
| `knowledge/lifecycle-management.md` | 处理重启、回收、异常恢复时 |
