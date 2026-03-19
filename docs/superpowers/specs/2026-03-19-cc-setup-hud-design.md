# cc-setup HUD 增强设计

## 概述

将 claude-hud 的核心能力（工具活动、Agent 追踪、Todo 进度、Usage 限额）移植到现有 `skills/cc-setup` 的 bash statusline 中，采用读写分离架构：statusline 只读缓存渲染，重活交给后台脚本异步写入。

## 架构

### 读写分离

```
statusline.sh (每 ~300ms 被 Claude Code 调用)
  ├── 读 stdin JSON → 项目路径、模型、上下文、transcript_path
  ├── 读 <project>/.claude/hud-cache.json → 工具/Agent/Todo
  ├── 读 ~/.claude/hud-usage-cache.json → Usage 限额
  ├── 渲染所有已启用的段
  ├── 检查 <project>/.claude/hud-last-scan
  │   → 超过 transcriptRefreshSeconds？后台启动 scan-transcript.sh &
  └── 检查 ~/.claude/hud-usage-last-fetch
      → 超过 usageRefreshSeconds 且在活跃时段？后台启动 usage-fetch.sh &

scan-transcript.sh (后台异步)
  ├── 读 transcript JSONL（路径从参数传入）
  ├── jq 提取 tools / agents / todos
  ├── 写 <project>/.claude/hud-cache.json
  └── 写 <project>/.claude/hud-last-scan

usage-fetch.sh (后台异步)
  ├── 从 macOS Keychain / ~/.claude/.credentials.json 读 OAuth token
  ├── curl 调用 https://api.anthropic.com/api/oauth/usage
  ├── 写 ~/.claude/hud-usage-cache.json
  └── 写 ~/.claude/hud-usage-last-fetch
```

### 状态文件分离

```
~/.claude/                            ← 全局状态（账户级）
  hud-config.json                     ← 配置文件
  hud-usage-cache.json                ← Usage API 响应缓存
  hud-usage-last-fetch                ← 上次 API 请求的 unix 时间戳

<project>/.claude/                    ← 项目状态（会话级）
  hud-cache.json                      ← 工具/Agent/Todo 缓存
  hud-last-scan                       ← 上次 transcript 扫描的 unix 时间戳
```

### 限流策略

| 数据 | 刷新间隔 | 条件 |
|------|----------|------|
| 工具/Agent/Todo | 可配，默认 5 秒 | 无限制 |
| Usage API | 可配，默认 3600 秒 | UTC+8 9:00-23:00 |

statusline.sh 每次运行时检查时间戳文件，未到刷新间隔则跳过触发，直接用缓存渲染。

## 脚本文件

```
skills/cc-setup/scripts/
  statusline.sh             ← 现有，扩展：读缓存 + 渲染新段 + 触发后台
  scan-transcript.sh        ← 新增，解析 transcript JSONL
  usage-fetch.sh            ← 新增，调 Anthropic Usage API
```

## 配置

文件：`~/.claude/hud-config.json`（全局级，跟随用户）

```json
{
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "context", "usage", "agents", "todos"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red"
  },
  "refresh": {
    "transcriptRefreshSeconds": 5,
    "usageRefreshSeconds": 3600,
    "usageActiveHoursUTC8": [9, 23]
  }
}
```

配置项说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pathLevels` | 1-3 | 1 | 项目路径显示层级 |
| `elementOrder` | string[] | 见上 | 渲染顺序，省略则不显示 |
| `gitStatus.enabled` | bool | true | 显示 git 分支 |
| `gitStatus.showDirty` | bool | true | 显示 `*` 表示有未提交变更 |
| `gitStatus.showAheadBehind` | bool | false | 显示 `↑N ↓N` |
| `gitStatus.showFileStats` | bool | false | 显示 `!M +A ✘D ?U` |
| `display.showTools` | bool | false | 工具活动行 |
| `display.showAgents` | bool | false | Agent 追踪行 |
| `display.showTodos` | bool | false | Todo 进度行 |
| `display.showDuration` | bool | false | 会话时长 |
| `colors.*` | string | 见上 | ANSI 颜色名 |
| `refresh.transcriptRefreshSeconds` | int | 5 | transcript 扫描间隔 |
| `refresh.usageRefreshSeconds` | int | 3600 | Usage API 请求间隔 |
| `refresh.usageActiveHoursUTC8` | [int,int] | [9,23] | UTC+8 活跃时段 |

## 渲染格式

### 基础行（现有，不变）

```
~/.../project | main +3 -1 | Opus · high | ctx 45% [=====-----] 90/200k · $0.47
```

### 新增行（按 elementOrder 和 display 开关决定是否显示）

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2          ← tools
◐ explore [haiku]: Finding auth code (2m 15s)      ← agents
▸ Fix authentication bug (2/5)                      ← todos
Usage ██░░░░░░░░ 25% (1h30m / 5h)                  ← usage
```

### 渲染逻辑

**tools**：
- 最近 2 个 status=running 的工具（黄色 `◐`），显示工具名 + target
- 前 4 个已完成工具按调用次数排序（绿色 `✓`），显示 `×N`
- target 提取：Read/Write/Edit → file_path，Glob/Grep → pattern，Bash → command 前 30 字符

**agents**：
- 所有 running + 最近 2 个 completed（最多 3 个）
- 显示：状态图标 + 类型 + [模型] + 描述 + (耗时)
- 识别方式：transcript 中 tool_use.name === "Task"

**todos**：
- 找到当前 in_progress 的任务，显示内容 + (已完成/总数)
- 全部完成时显示 `✓ All todos complete (N/N)`
- 数据来源：transcript 中 TodoWrite / TaskCreate / TaskUpdate 工具调用

**usage**：
- 显示 5 小时窗口 utilization 百分比 + 进度条
- 到 100% 时用 critical 颜色
- API 返回 `five_hour.utilization`（0-100）和 `five_hour.resets_at`

## scan-transcript.sh 设计

输入：`$1` = transcript JSONL 路径，`$2` = 项目目录

处理逻辑：
1. 逐行读取 JSONL
2. 提取 `message.content[]` 中的 `tool_use` 和 `tool_result` 块
3. tool_use.name === "Task" → 记为 agent
4. tool_use.name === "TodoWrite" / "TaskCreate" / "TaskUpdate" → 更新 todos
5. 其他 tool_use → 记为 tool
6. tool_result.tool_use_id → 标记对应 tool/agent 为 completed
7. 取最近 20 个 tools、最近 10 个 agents、最新 todos 列表

输出 `hud-cache.json` 格式：

```json
{
  "tools": [
    { "id": "xxx", "name": "Read", "target": "src/index.ts", "status": "completed" },
    { "id": "yyy", "name": "Edit", "target": "src/auth.ts", "status": "running" }
  ],
  "agents": [
    { "id": "zzz", "type": "explore", "model": "haiku", "description": "Finding auth code", "status": "running", "startTime": 1710000000 }
  ],
  "todos": [
    { "content": "Fix authentication bug", "status": "in_progress" },
    { "content": "Add tests", "status": "pending" }
  ],
  "sessionStart": 1710000000
}
```

并发控制：使用 lock 文件 `<project>/.claude/hud-scan.lock`，脚本启动时检查，存在则直接退出。

注意：transcript_path 由 Claude Code 通过 stdin JSON 提供，不需要硬编码路径或 glob 匹配。statusline.sh 从 stdin 提取后作为参数传给 scan-transcript.sh。

## usage-fetch.sh 设计

处理逻辑：
1. 检查 UTC+8 时间是否在 `usageActiveHoursUTC8` 范围内，不在则直接退出
2. 读取 OAuth 凭据：
   - macOS：`/usr/bin/security find-generic-password -s "Claude Code-credentials" -w`
   - 降级：读 `~/.claude/.credentials.json`
3. 检查 token 是否过期（`expiresAt` 字段）
4. 从 `subscriptionType` 判断 plan（Max/Pro/Team），API 用户直接退出
5. `curl` 请求 `https://api.anthropic.com/api/oauth/usage`
   - Header: `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`
   - 超时 15 秒
6. 解析响应，写入 `hud-usage-cache.json`

输出 `hud-usage-cache.json` 格式：

```json
{
  "planName": "Max",
  "fiveHour": 25,
  "sevenDay": 60,
  "fiveHourResetAt": "2026-03-19T15:00:00Z",
  "sevenDayResetAt": "2026-03-22T00:00:00Z",
  "fetchedAt": 1710000000
}
```

失败处理：请求失败时写入 `{ "error": "timeout", "fetchedAt": ... }`，statusline 渲染时忽略 error 条目，沿用上次成功数据。

## 通用约定

### 缓存写入原子性

所有缓存文件写入必须先写临时文件再 rename，防止 statusline 读到半写的 JSON：

```bash
jq ... > "$CACHE_FILE.tmp" && mv "$CACHE_FILE.tmp" "$CACHE_FILE"
```

### 后台脚本模型

scan-transcript.sh 和 usage-fetch.sh 都是 **一次性脚本**（非常驻 daemon）：
- 由 statusline.sh 在限流检查通过后以 `& disown` 启动
- 执行完写入缓存后立即退出
- 用 lock 文件防止并发重复执行（启动时检查 lock，存在则退出；执行完删除 lock）
- lock 文件超过 30 秒视为 stale，强制删除后重新获取

### 配置缺失时的默认行为

`~/.claude/hud-config.json` 不存在时，statusline.sh 使用内置默认值：
- 所有 display 开关为 false（只显示基础行）
- transcriptRefreshSeconds = 5
- usageRefreshSeconds = 3600
- usageActiveHoursUTC8 = [9, 23]

即：首次使用时只有基础 statusline，需要跑 `/cc-setup` 开启高级功能。

## cc-setup 引导流程扩展

现有流程两项不变，在"HUD 状态栏"项中增加子选项：

```
/cc-setup 启动后依次询问：

1. Skill 调用日志（现有）
2. HUD 状态栏（现有，扩展子选项）
   a. 基础信息：项目路径、git、模型、上下文（默认开）
   b. 工具活动 showTools（默认关）
   c. Agent 追踪 showAgents（默认关）
   d. Todo 进度 showTodos（默认关）
   e. Usage 限额 showUsage（默认关）
   选择后写入 ~/.claude/hud-config.json
```

检测逻辑：读取 `~/.claude/hud-config.json`，显示各项当前状态。

## 不做的事

- 不做 compact 布局（bash 脚本没必要两套渲染）
- 不做 `showConfigCounts`（CLAUDE.md/rules/hooks 数量用处不大）
- 不做代理隧道（bash 下 curl 自带 proxy 支持，环境变量即可）
- 不做 7-day usage 独立显示（合并在 usage 行，超阈值时才显示）
