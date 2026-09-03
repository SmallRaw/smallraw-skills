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

**数据来源**：`scan-transcript.sh` 提取所有 Skill 调用的 skill 名称（去重、按调用顺序），写入 `~/.claude/hud/sessions/<session_id>.json` 的 `skills` 字段

**防新旧 session 串数据**：缓存按 statusline stdin 里的 `session_id` 一个 session 一个文件，天然不会串；超过 2 天未更新的文件由 `scan-transcript.sh` 自动清理

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
| Usage 限额 | `display.showUsage` | 关 | 显示 Pro/Max/Team 用量百分比（每半小时刷新，UTC+8 9-23 点）；抓取失败时显示上次数据并带灰色 `✗ <原因>` 标记，限流时带 `↻` |
| 会话时长 | `display.showDuration` | 关 | 显示当前会话已持续时间（如 `12m`、`1h 30m`） |
| 配置概览 | `display.showConfigCounts` | 关 | 显示生效的 CLAUDE.md、rules、MCP、hooks 数量，快速排查配置来源 |
| Skill 追踪 | `display.showSkills` | 关 | 显示当前 session 已加载的 skill 列表（从 transcript 解析） |

**检测 HUD 子选项**：读取 `~/.claude/hud-config.json`，显示各项当前状态

**配置文件结构**（`~/.claude/hud-config.json`，所有字段可省略）：

```json
{
  "pathLevels": 1,
  "display": { "showTools": false, "showAgents": false, "showTodos": false, "showUsage": false,
               "showSkills": false, "showDuration": false, "showConfigCounts": false },
  "refresh": { "transcriptRefreshSeconds": 5, "usageRefreshSeconds": 1800, "usageActiveHoursUTC8": [9, 23] }
}
```

**运行时状态目录**：脚本产生的一切状态都在 `~/.claude/hud/` 下（可用环境变量 `CLAUDE_HUD_DIR` 覆盖）：
`sessions/<session_id>.json` 会话缓存、`sessions/<session_id>.scan-ts` 扫描时间戳、`sessions/<session_id>.git` git 统计缓存（3 秒）、
`usage-cache.json` / `usage-last-fetch` / `keychain-backoff` 用量抓取状态。**脚本绝不能往项目目录写任何文件**。

## Gotchas

1. **settings.json 语法错误会静默禁用所有设置**。修改后必须 `jq -e . <file>` 验证
2. **项目级 `.claude/settings.local.json` 不会自动 gitignore**。首次创建时检查 `.gitignore`
3. **hook 修改后需要重启 session 或打开 `/hooks` 才生效**。完成后提醒用户
4. **合并 hooks 数组时注意去重**。同一个 event+matcher 不要重复添加
5. **statusLine script 路径必须是绝对路径**。不能用相对路径或 `~`
6. **transcript 是边写边读的**。扫描时最后一行经常不完整，`scan-transcript.sh` 用 `fromjson?` 逐行容错，并且无论成败都写扫描时间戳，否则失败会变成每次刷新都重试
7. **用量接口是未公开接口**。`usage-fetch.sh` 用钥匙串里的 OAuth token 调 `api.anthropic.com/api/oauth/usage`，Anthropic 随时可能改；失败时状态栏会显示 `✗ <原因>`，看到它先查这里

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
