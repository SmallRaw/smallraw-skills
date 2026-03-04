# tmux-agent Skill 设计文档

> 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作。专为 OpenClaw 设计。

## 需求摘要

- **使用者：** OpenClaw 项目
- **主控/被调度方：** 任意 AI CLI 工具（Claude Code、Gemini CLI、Codex 等）
- **持久化粒度：** 工具级（session + 任务状态 + 生命周期管理）
- **交互模式：** Fire-and-forget（派任务后不管，稍后收结果）
- **工具模板：** 不预设，纯原始能力
- **环境隔离：** Skill 不管，由 OpenClaw 决定
- **结果收集：** 读 tmux 终端输出（capture-pane）

## 方案选择

**方案 A：纯指令手册**（从三个方案中选出）

Skill 本质是 tmux 操作手册 + 生命周期管理规范。Agent 通过 bash 直接调用 tmux 命令，状态通过约定的 JSON 文件持久化。

选择理由：最轻量、通用性最好、不依赖 MCP 或额外脚本、tmux 命令本身就是稳定 API。

## 文件结构

```
skills/tmux-agent/
├── SKILL.md                          # 主入口：元数据 + 核心指令手册
├── README.md                         # 安装/使用说明
└── knowledge/
    ├── tmux-primitives.md            # tmux 原语操作参考
    ├── lifecycle-management.md       # 工具生命周期管理规则
    └── state-protocol.md             # 状态文件协议（.tmux-agents.json）
```

## 核心架构：三层模型

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

### Layer 1：tmux 原语

| 操作 | 用途 | 示例命令 |
|------|------|---------|
| 创建 session | 为一组任务创建隔离环境 | `tmux new-session -d -s openclaw` |
| 创建 window | 每个工具实例一个 window | `tmux new-window -t openclaw -n agent-1` |
| 发送命令 | 向工具实例派任务 | `tmux send-keys -t openclaw:agent-1 'cmd' Enter` |
| 读取输出 | 获取工具的终端输出 | `tmux capture-pane -t openclaw:agent-1 -p` |
| 检测进程 | 判断工具是否还活着 | `tmux list-panes -F '#{pane_pid}'` + `ps -p` |
| 销毁 window | 清理已完成的工具实例 | `tmux kill-window -t openclaw:agent-1` |
| 销毁 session | 清理整个调度环境 | `tmux kill-session -t openclaw` |

约定：session 名用项目名，window 名用 `agent-<id>` 格式。

### Layer 2：状态协议

项目根目录下 `.tmux-agents.json`：

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
    }
  ]
}
```

状态流转：`running` → `completed` | `failed` | `restarted`

核心原则：状态文件是"声明"，tmux + pid 是"事实"。重连时以事实为准，修正状态文件。

### Layer 3：生命周期管理

| 场景 | 检测方式 | 处理策略 |
|------|---------|---------|
| 工具正常完成 | pane 内进程退出，exit code 0 | 更新状态为 `completed`，保留 window |
| 工具异常退出 | pane 内进程退出，exit code ≠ 0 | 更新状态为 `failed`，保留现场 |
| 工具卡死 | 进程存在但长时间无新输出 | 由主控 Agent 决定是否 kill 并重启 |
| 主控重连 | 读 `.tmux-agents.json` + 逐个检查 pid | 刷新所有 agent 的真实状态 |
| 资源回收 | 所有 agent 都 completed/failed | 可 kill-session 清理 |

异常场景：
- tmux server 挂了：状态文件还在，重建 session
- 状态文件损坏：从 tmux 实际状态重建

## SKILL.md 设计

### 元数据

```yaml
---
name: tmux-agent
description: 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作
license: MIT
compatibility: claude-code, opencode, gemini-cli, codex
metadata:
  homepage: https://github.com/anthropics/smallraw-skills
  author: smallraw
user-invocable: false
disable-model-invocation: false
---
```

### 正文结构

```
# tmux-agent — 多 AI CLI 工具调度协议
> 通过 tmux 实现 AI Agent 对其他 AI CLI 工具的持久化调度

## 何时使用
## 核心工作流
  ### 1. 初始化调度环境
  ### 2. 派发任务
  ### 3. 检查状态
  ### 4. 收集结果
  ### 5. 生命周期管理
  ### 6. 重连恢复
## 规则
## 知识库文件
```

### 硬规则

- 禁止在没有更新 `.tmux-agents.json` 的情况下创建或销毁 window
- 禁止假设工具状态，必须通过 pid 检测确认
- 禁止删除 status 为 failed 的 window，除非主控明确要求
- 派发任务流程：创建 window → 记录状态 → 发送命令 → 确认进程启动 → 更新 pid
- 重连恢复流程：读状态文件 → 检查 session 存在 → 逐个验证 pid → 修正状态 → 报告

## 知识库文件设计

### knowledge/tmux-primitives.md

tmux 命令精确参考，覆盖：
- Session 管理：`new-session`、`has-session`、`kill-session`、`list-sessions`
- Window 管理：`new-window`、`kill-window`、`list-windows`
- 命令交互：`send-keys`（含特殊键处理）
- 输出读取：`capture-pane -p`（含 `-S` 行范围控制）
- 进程检测：`list-panes -F '#{pane_pid}'` + `ps -p` 组合
- 环境信息：`display-message -p`

每条命令附完整可复制示例。

### knowledge/lifecycle-management.md

工具实例全生命周期规则：
- 状态流转图：创建 → 运行中 → 完成/失败 → 保留 → 回收
- 健康检查方法：pid 存在性、进程状态（zombie/stopped）
- 完成判定：`#{pane_dead}` 或 pid 不存在
- 重启策略：同一 window 重新 send-keys，记录重启次数
- 回收策略：读取结果后 kill-window，全部完成后 kill-session
- 异常场景：tmux server 崩溃恢复、状态文件损坏重建

### knowledge/state-protocol.md

`.tmux-agents.json` 完整协议：
- JSON Schema（字段类型、必填/可选、枚举值）
- 读写时机：创建后写入、检查后更新、销毁后删除条目
- 并发安全：单主控无并发问题，处理文件不存在的初始化
- 状态修正：与 tmux 实际状态不一致时以 tmux 为准
- 文件位置：项目根目录，加入 `.gitignore`
