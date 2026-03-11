# CC-Switch Provider 会话路径参考

> **注意：此文件不是 skill 的一部分，仅作为未来扩展多 provider 支持时的参考。**
> 来源：[cc-switch](https://github.com/farion1231/cc-switch) (commit fb8996d)

---

## 各 Provider 会话存储路径

| Provider | 配置目录 | 会话存储路径 | 文件格式 | Resume 命令 |
|----------|----------|-------------|---------|-------------|
| Claude Code | `~/.claude/` | `~/.claude/projects/{path-hash}/*.jsonl` | JSONL | `claude --resume {session_id}` |
| Codex | `~/.codex/` | `~/.codex/sessions/**/*.jsonl` | JSONL | `codex resume {session_id}` |
| Gemini CLI | `~/.gemini/` | `~/.config/gemini/tmp/{project_hash}/chats/session-*.json` | JSON | - |
| OpenCode | `~/.config/opencode/` | `~/.local/share/opencode/storage/session/*.json`（或 `$XDG_DATA_HOME/opencode/storage/`） | JSON | - |
| OpenClaw | `~/.openclaw/` | `~/.openclaw/agents/{agent_name}/sessions/*.jsonl` | JSONL | - |

## 路径映射规则

### Claude Code
- 项目路径 `/` → `-`
- 例：`/Users/foo/my-project` → `~/.claude/projects/-Users-foo-my-project/`

### Codex
- 会话目录下递归扫描 `.jsonl` 文件
- Session ID 可从文件名中通过 UUID 正则推断

### Gemini CLI
- 项目按 hash 分组在 `tmp/` 下
- 消息角色：`user` / `gemini`（映射为 assistant）
- 单个 JSON 文件包含完整 `messages` 数组

### OpenCode
- 三层存储结构：`session/` → `message/{sessionID}/` → `part/{messageID}/`
- 遵循 XDG 规范

### OpenClaw
- 按 agent 名称分组
- 跳过 `sessions.json` 索引文件
- JSONL 格式与 Claude Code 类似

## 各 Provider 配置文件

| Provider | 主配置 | 认证文件 | MCP 配置 |
|----------|--------|---------|---------|
| Claude Code | `~/.claude/settings.json` | - | `~/.claude.json` |
| Codex | `~/.codex/config.toml` | `~/.codex/auth.json` | - |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/.env` | - |
| OpenCode | `~/.config/opencode/opencode.json` | `~/.config/opencode/.env` | 内嵌在 `opencode.json` |
| OpenClaw | `~/.openclaw/openclaw.json` | - | - |

## 规范文件（Prompt Files）

| Provider | 规范文件名 |
|----------|-----------|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| OpenCode | `AGENTS.md` |
| OpenClaw | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

## JSONL 通用字段（Claude / Codex / OpenClaw）

```jsonc
{
  "type": "user|assistant|system|progress|file-history-snapshot",
  "sessionId": "uuid",
  "cwd": "/project/path",
  "gitBranch": "main",
  "timestamp": "ISO-8601",
  "message": {
    "role": "user|assistant",
    "content": "string" // 或 [{"type": "text", "text": "..."}]
  },
  "isMeta": true  // 元数据行，分析时跳过
}
```

## 解析策略（来自 cc-switch）

- **高效读取**：只读文件头部 10 行（提取元数据）+ 尾部 30 行（提取最近活动和摘要）
- **过滤规则**：跳过 `isMeta: true`、`agent-` 前缀文件
- **摘要截断**：160 字符
- **并发扫描**：5 个 provider 并行扫描，结果按 `last_active_at` 降序排列
