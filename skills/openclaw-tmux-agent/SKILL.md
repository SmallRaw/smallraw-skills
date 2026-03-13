---
name: openclaw-tmux-agent
description: 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作。当需要将子任务委派给其他 AI CLI 工具（claude-code、opencode、gemini-cli、codex）、并行运行多个实例、检查任务状态或断线重连恢复时触发。
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: false
disable-model-invocation: false
---

# openclaw-tmux-agent — 多 AI CLI 工具调度协议

> 通过 tmux 实现 AI Agent 对其他 AI CLI 工具的持久化调度。

## 前提条件

- `tmux` 已安装（`command -v tmux`）
- `.tmux-agents.json` 可读写

## 架构

```
Layer 3 — 生命周期管理（重启/回收/清理/重连）
  → knowledge/lifecycle-management.md
Layer 2 — 状态协议（.tmux-agents.json 读写）
  → knowledge/state-protocol.md
Layer 1 — tmux 原语（session/window/send-keys/capture-pane）
  → knowledge/tmux-primitives.md
```

## 核心工作流

### 1. 初始化

创建 tmux session + 初始化状态文件。如果 `.tmux-agents.json` 已存在，跳到步骤 6（重连恢复）。

### 2. 派发任务（严格五步，不可跳步）

1. 创建 window
2. 写入状态文件（status: "starting", pid: null）
3. 发送命令（TUI 工具必须用 `-l` + 分离 Enter，见 tmux-primitives.md）
4. 确认进程启动（获取 pane_pid → pgrep 找子进程）
5. 更新 pid 到状态文件（status: "running"）

### 3. 检查状态

组合 tmux pane 信息 + `ps -p <pid>` 验证进程是否存活。禁止仅凭状态文件判断。

### 4. 收集结果

用 `tmux capture-pane` 读取 Agent 输出。参数用法见 tmux-primitives.md。

### 5. 生命周期管理

详见 `knowledge/lifecycle-management.md`：
- **重启**：在同一 window 重新发送命令，更新 pid
- **回收**：kill-window + 从状态文件删除
- **清理**：kill-session + 删除状态文件

### 6. 重连恢复

读状态文件 → 检查 session → 逐个验证 pid → 修正状态 → 报告。

## 规则

### 禁止规则

1. **禁止脱离状态文件操作 window** — 任何 new-window / kill-window 必须同步更新 `.tmux-agents.json`
2. **禁止不经 pid 检查就假定状态** — 必须用 `ps -p <pid>` 验证，不可仅看状态文件
3. **禁止自动删除失败的 window** — 仅更新状态为 "exited"/"failed"，不自动 kill-window

### 过程规则

1. **派发流程**：严格五步，不可跳步或乱序
2. **重连流程**：严格五步（读状态 → 检查 session → 验证 pid → 修正 → 报告）
3. **状态修正**：状态文件是声明，tmux + pid 是事实。以事实为准修正声明

## 实战技巧

### TUI 命令发送

AI CLI 工具（Claude Code、Codex 等）必须文本和 Enter 分开发送：

```bash
# ✅ 正确
tmux send-keys -t session:window -l -- "Fix the bug" && sleep 0.1 && tmux send-keys -t session:window Enter
```

### Session 命名

使用 `oc-<项目>-<功能>` 前缀，避免冲突。

### Shell Prompt 完成检测

作为 pid 检测的补充，检查 pane 最后几行是否有 shell 提示符。详见 tmux-primitives.md。

## 知识库（按需加载）

| 文件 | 何时读取 |
|------|----------|
| `knowledge/tmux-primitives.md` | 需要 tmux 命令的具体参数和用法时 |
| `knowledge/state-protocol.md` | 需要读写 .tmux-agents.json 的 schema 和规则时 |
| `knowledge/lifecycle-management.md` | 处理重启、回收、异常恢复时 |
