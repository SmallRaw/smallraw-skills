---
name: mcp-lazy-cli
description: MCP Skill System — 按需调用 MCP servers，不预加载。通过 registry 索引知道有什么能力，用 CLI 按需连接、调用、断开。当需要与外部工具交互（设计工具、数据库、API 等）但该工具未预加载为 MCP 时使用。
allowed-tools:
  - Bash
  - Read
---

# MCP CLI — 按需调用 MCP Servers

不预加载 tool definitions，通过 registry 知道有什么能力，按需调用。

先 `--registry` 看有什么，根据 `when` 字段判断是否需要，不需要就不调用。

```bash
# 查看所有可用 servers（读 .claude/mcp-registry.json）
npx mcp-client-utils --registry

# 查看某个 server 的完整 tool schema（参数不确定时才用）
npx mcp-client-utils --server <name> tools

# 调用 tool
npx mcp-client-utils --server <name> call <tool-name> '<json-args>'

# 其他命令
npx mcp-client-utils --server <name> info
npx mcp-client-utils --server <name> resources
npx mcp-client-utils --server <name> read <uri>
npx mcp-client-utils --server <name> prompts
npx mcp-client-utils --server <name> prompt <prompt-name> '<json-args>'
npx mcp-client-utils --server <name> templates

# Ad-hoc 直连（不经过 registry）
npx mcp-client-utils --stdio "<cmd> [args]" -- <command>
npx mcp-client-utils --http <url> -- <command>
npx mcp-client-utils --sse <url> -- <command>

# Daemon 管理
npx mcp-client-utils daemon status
npx mcp-client-utils daemon start
npx mcp-client-utils daemon stop
```

## lifecycle

Registry 中每个 server 可配置 `"lifecycle"` 字段：

- **`"ephemeral"`**（默认）— 无状态，每次调用独立连接，用完即断。Ad-hoc 直连也是这个模式。
- **`"keep-alive"`** — 有状态，通过后台 daemon 保持连接，多次调用复用同一会话。适用于设计工具、数据库等需要维持上下文的 server。

Registry 配置：`.claude/mcp-registry.json`，schema 见 `skills/mcp-lazy-cli/mcp-registry.schema.json`。
