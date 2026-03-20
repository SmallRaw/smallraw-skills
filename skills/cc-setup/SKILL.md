---
name: cc-setup
description: "User types /cc-setup to interactively configure Claude Code settings — skill usage logging hook, HUD statusLine, and future extensions."
user-invocable: true
disable-model-invocation: true
---

# Claude Code 配置向导

交互式配置 Claude Code 的 hooks、HUD 等设置。每个配置项独立，可单独开关或重新设置。

## 核心规则

1. **先检测再提问**。每个配置项先读取当前状态（已开启/已关闭/未配置），展示给用户后再问是否修改
2. **问作用域**。每个配置项都要问：项目级（`.claude/settings.local.json`）还是全局级（`~/.claude/settings.json`）
3. **合并不覆盖**。写入 settings 时必须 merge 现有内容，不能丢失已有配置
4. **脚本能做的不用 AI**。hook command 用纯 bash/jq，不消耗 token

## 配置项

启动后依次询问以下配置项（用户可跳过任何一项）：

### 1. Skill 加载状态

显示当前 session 已加载的 skill 列表。**不需要 hook**，从 transcript 解析 Skill tool_use 记录。

**数据来源**：`scan-transcript.sh` 提取所有 Skill 调用的 skill 名称（去重、按调用顺序），写入 `hud-cache.json` 的 `skills` 字段

**防新旧 session 串数据**：`hud-cache.json` 中记录 `sessionId`，statusline 对比 stdin 中的 `session_id`，不匹配则不显示

**显示**：独立一行，格式 `⚡ skill-a | ⚡ skill-b`。无 skill 加载时不显示该行，始终开启无需配置

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

**检测 HUD 子选项**：读取 `~/.claude/hud-config.json`，显示各项当前状态

**配置文件结构**：完整配置参考 `docs/superpowers/specs/2026-03-19-cc-setup-hud-design.md`

## Gotchas

1. **settings.json 语法错误会静默禁用所有设置**。修改后必须 `jq -e . <file>` 验证
2. **项目级 `.claude/settings.local.json` 不会自动 gitignore**。首次创建时检查 `.gitignore`
3. **hook 修改后需要重启 session 或打开 `/hooks` 才生效**。完成后提醒用户
4. **合并 hooks 数组时注意去重**。同一个 event+matcher 不要重复添加
5. **statusLine script 路径必须是绝对路径**。不能用相对路径或 `~`

## 交互流程

```
1. 读取当前 settings（项目级 + 全局级）
2. 对每个配置项：
   a. 显示当前状态（✅ 已开启 / ❌ 未配置）
   b. 问：开启/关闭/跳过？
   c. 如果要修改，问：项目级还是全局级？
   d. 执行修改，验证 JSON
3. 汇总所有变更
4. 提醒用户重启 session 或 /hooks 刷新
```
