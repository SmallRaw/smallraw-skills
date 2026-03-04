# openclaw-tmux-agent Skill

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
│              主控 Agent                      │
│   （claude-code / opencode / gemini-cli）     │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
       ▼          ▼          ▼
┌──────────┐┌──────────┐┌──────────┐
│ tmux :0  ││ tmux :1  ││ tmux :2  │
│claude-code││ opencode ││gemini-cli│
│ 重构模块  ││ 写测试   ││ 生成文档  │
└──────────┘└──────────┘└──────────┘
  window 0    window 1    window 2
```

主控 Agent 在 tmux session 中创建多个 window，每个 window 运行一个 AI CLI 工具实例，各自执行独立任务。主控断开后 session 保持运行，重连后通过状态文件恢复调度。

---

## 文件结构

```
tmux-agent/
├── README.md                          # 本文件
├── SKILL.md                           # Skill 能力描述（入口）
└── knowledge/
    ├── tmux-primitives.md             # tmux 命令原语参考
    ├── state-protocol.md              # .tmux-agents.json 状态文件协议
    └── lifecycle-management.md        # Agent 生命周期管理详解
```

---

## 三层架构

| Layer | 职责 | 知识库文件 |
|-------|------|-----------|
| Layer 1 — tmux 原语 | 封装 tmux 操作：new-session / new-window / send-keys / capture-pane / list-panes / kill-window | `knowledge/tmux-primitives.md` |
| Layer 2 — 任务状态协议 | `.tmux-agents.json` 状态文件的读写与状态流转 | `knowledge/state-protocol.md` |
| Layer 3 — 生命周期管理 | 健康检查 / 重启 / 回收 / 清理 / 重连恢复 | `knowledge/lifecycle-management.md` |

- **Layer 1** 是底层命令层，封装 tmux 操作细节
- **Layer 2** 是状态持久化层，所有 Agent 信息记录到 `.tmux-agents.json`
- **Layer 3** 是管理层，处理异常恢复、进程重启、资源回收等高层逻辑

---

## 核心工作流

```
1. 初始化 → 检查 tmux、创建 session、初始化状态文件
2. 派发   → 创建 window → 写入状态 → 发送命令 → 确认 pid → 更新状态
3. 检查   → 组合 tmux pane 信息与 ps -p 验证 Agent 是否存活
4. 收集   → capture-pane 读取 Agent 输出
5. 管理   → 重启（failed）/ 回收（exited）/ 全部清理
6. 恢复   → 读状态文件 → 检查 session → 逐个验证 pid → 修正状态 → 报告
```

### 关键规则

- **状态文件是声明，tmux + pid 是事实**——不一致时以事实为准
- **禁止脱离状态文件操作 window**——new-window 和 kill-window 必须同步更新状态文件
- **禁止不经 pid 检查就假定状态**——必须用 `ps -p` 验证进程是否真实存在
- **禁止自动删除 failed 的 window**——由主控 Agent 明确决定重启或放弃

---

## 设计来源

这个 Skill 为 [OpenClaw](https://github.com/openclaw/openclaw) 项目设计，将其多 Agent 协作调度经验提炼为可复用的 tmux 调度协议。核心思路：用 tmux 的 session/window 作为进程容器，用 JSON 状态文件实现持久化，用 pid 验证确保状态真实性。

---

## License

MIT
