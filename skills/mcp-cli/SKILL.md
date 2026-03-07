---
name: mcp-cli
description: MCP Skill System — 按需调用 MCP servers，不预加载。通过 registry 索引知道有什么能力，用 CLI 按需连接、调用、断开。当需要与外部工具交互（设计工具、数据库、API 等）但该工具未预加载为 MCP 时使用。
allowed-tools:
  - Bash
  - Read
---

# MCP CLI — MCP Skill System

像 skill 按需加载一样使用 MCP servers：registry 是索引，CLI 是执行器。

不预加载 MCP server 的 tool definitions（节省上下文），通过 registry 知道有什么能力，按需调用。

## CLI

```bash
node .claude/skills/mcp-cli/script/mcp-cli.cjs <options> <command>
```

## 工作流

### 1. 查看可用 servers

```bash
node .claude/skills/mcp-cli/script/mcp-cli.cjs --registry
```

输出 `.claude/mcp-registry.json`：每个 server 的名称、描述、`when` 触发条件、工具概要。

根据 `when` 字段判断当前任务是否需要某个 server。不需要就不调用。

### 2. 查看完整 tool schema（按需）

```bash
node .claude/skills/mcp-cli/script/mcp-cli.cjs --server <name> tools
```

只在需要知道参数细节时调用。

### 3. 调用 tool

```bash
node .claude/skills/mcp-cli/script/mcp-cli.cjs --server <name> call <tool-name> '<json-args>'
```

### 4. 其他命令

```bash
--server <name> info                    # Server 信息
--server <name> resources               # 列出 resources
--server <name> read <uri>              # 读取 resource
--server <name> prompts                 # 列出 prompts
--server <name> prompt <name> '<json>' # 获取 prompt
--server <name> templates               # Resource templates
```

## 决策规则

- **不需要就不调用** — registry 的 `when` 字段已经说清楚了
- **先看概要再看 schema** — registry 里的一行描述通常够判断用哪个 tool，参数不确定时才 `tools` 拿完整 schema
- **每次调用是独立连接** — 没有常驻进程，用完即断
- **stderr 是 server 日志** — 正常输出在 stdout，用 `2>/dev/null` 过滤

## Registry

配置文件：`.claude/mcp-registry.json`

添加新 server：

```json
{
  "servers": {
    "my-server": {
      "description": "一句话说明",
      "when": "什么时候用",
      "transport": {
        "type": "stdio | http | sse",
        "target": "/path/to/server 或 http://host:port/mcp",
        "args": ["--flag", "value"]
      },
      "tools": [
        { "name": "tool_name", "description": "一句话" }
      ],
      "notes": "前置条件或注意事项"
    }
  }
}
```

## 重新编译

```bash
cd .claude/skills/mcp-cli/sources && npm install && npm run build
cp dist/mcp-core.cjs ../script/mcp-cli.cjs
```
