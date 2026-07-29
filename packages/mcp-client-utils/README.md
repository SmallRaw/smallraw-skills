# mcp-client-utils

Generic MCP (Model Context Protocol) client CLI for AI agents. Connects to any MCP server via stdio, HTTP, or SSE — with optional daemon mode for keep-alive connections.

## Install

Requires Node.js 20 or newer.

```bash
npx mcp-client-utils --help
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
npx mcp-client-utils --server my-server tools
npx mcp-client-utils --server my-server tools --compact
npx mcp-client-utils --server my-server call my_tool --help
npx mcp-client-utils --server my-server call my_tool '{"key":"value"}'
npx mcp-client-utils --registry                # show all servers
```

### Ad-hoc Mode

Connect directly without a registry:

```bash
npx mcp-client-utils --stdio "/path/to/server --app desktop" -- tools
npx mcp-client-utils --http http://localhost:3000/mcp -- call my_tool '{"key":"val"}'
npx mcp-client-utils --sse http://localhost:3000/sse -- tools
```

### Protocol Versions

Connections automatically negotiate the MCP protocol version. The client probes
for MCP `2026-07-28` and falls back to the legacy protocol when needed, so
callers and agents do not need to select a version:

```bash
npx mcp-client-utils --http http://localhost:3000/mcp -- tools
npx mcp-client-utils --stdio "/path/to/server" -- tools
```

The optional `protocol` setting is only for compatibility overrides or testing:

```json
{
  "transport": {
    "type": "http",
    "target": "http://localhost:3000/mcp",
    "protocol": "legacy"
  }
}
```

Use `legacy` to skip discovery for an older server, or `2026-07-28` to require
the modern revision. Automatic negotiation on stdio may start a short-lived
probe process; set `legacy` only when an older server ignores discovery and the
probe delay is undesirable.

### Commands

| Command                    | Description              |
| -------------------------- | ------------------------ |
| `info`                     | Server info & capabilities |
| `tools`                    | List all tools (full schema) |
| `tools --compact`          | List tools with copyable call templates |
| `call <name> [json-args]`  | Call a tool              |
| `call <name> --help`       | Show one tool's argument template |
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
npx mcp-client-utils daemon start     # start daemon explicitly
npx mcp-client-utils daemon status    # show daemon status and connections
npx mcp-client-utils daemon stop      # stop daemon

# Regular commands work the same — daemon is used transparently
npx mcp-client-utils --server pencil tools
```

## Registry Lookup

The CLI searches upward from the current directory for:

1. `mcp-registry.json`
2. `.claude/mcp-registry.json`

## Agent-Friendly Operator Output

`mcp-client-utils` is designed as an MCP operator for agents:

- `--registry` prints compact server summaries and `Next` commands.
- `tools --compact` prints tool descriptions plus JSON argument templates.
- `call` without a tool name lists available tool call commands.
- `call <tool> --help` prints a copyable argument template for that tool.
- invalid JSON and tool errors exit non-zero with actionable text.

## Publishing

From this package directory:

```bash
npm login
npm whoami
npm test
npm publish --dry-run
npm publish
```

The package is unscoped and publishes publicly. Direct publishing requires npm
two-factor authentication or a granular access token that can bypass 2FA.

## License

MIT
