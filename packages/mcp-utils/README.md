# mcp-utils

Generic MCP (Model Context Protocol) client CLI for AI agents. Connects to any MCP server via stdio, HTTP, or SSE — with optional daemon mode for keep-alive connections.

## Install

```bash
npx mcp-utils --help
```

## Usage

### Registry Mode

Create a `mcp-registry.json` in your project (or `.claude/mcp-registry.json`):

```json
{
  "servers": {
    "my-server": {
      "description": "My MCP server",
      "transport": {
        "type": "stdio",
        "target": "/path/to/server",
        "args": ["--flag"]
      }
    }
  }
}
```

Then use `--server` to connect by name:

```bash
npx mcp-utils --server my-server tools
npx mcp-utils --server my-server call my_tool '{"key":"value"}'
npx mcp-utils --registry                # show all servers
```

### Ad-hoc Mode

Connect directly without a registry:

```bash
npx mcp-utils --stdio "/path/to/server --app desktop" -- tools
npx mcp-utils --http http://localhost:3000/mcp -- call my_tool '{"key":"val"}'
npx mcp-utils --sse http://localhost:3000/sse -- tools
```

### Commands

| Command                    | Description              |
| -------------------------- | ------------------------ |
| `info`                     | Server info & capabilities |
| `tools`                    | List all tools (full schema) |
| `call <name> [json-args]`  | Call a tool              |
| `resources`                | List resources           |
| `templates`                | List resource templates  |
| `read <uri>`               | Read a resource          |
| `prompts`                  | List prompts             |
| `prompt <name> [json-args]`| Get a prompt             |

## Daemon Mode

For servers that benefit from persistent connections, set `lifecycle: "keep-alive"` in the registry:

```json
{
  "servers": {
    "pencil": {
      "description": "Pencil editor MCP",
      "lifecycle": "keep-alive",
      "transport": {
        "type": "stdio",
        "target": "/path/to/pencil-mcp"
      }
    }
  }
}
```

Keep-alive servers are automatically routed through a background daemon process that maintains the connection. The daemon starts on first use and manages idle eviction (5min timeout).

```bash
npx mcp-utils daemon start     # start daemon explicitly
npx mcp-utils daemon status    # show daemon status and connections
npx mcp-utils daemon stop      # stop daemon

# Regular commands work the same — daemon is used transparently
npx mcp-utils --server pencil tools
```

## Registry Lookup

The CLI searches upward from the current directory for:

1. `mcp-registry.json`
2. `.claude/mcp-registry.json`

## License

MIT
