---
name: mcp-lazy-cli
description: "Lazy MCP proxy — call MCP servers on-demand without preloading. Use when the user wants to invoke MCP tools, connect to MCP servers, check the mcp-registry, or manage the MCP daemon."
allowed-tools:
  - Bash
  - Read
---

# MCP Lazy CLI — On-Demand MCP Server Invocation

## Why this exists

Registering MCP servers in Claude Code (or any AI tool) makes them preload into memory — every server, all the time, whether you need them or not. This wastes resources and slows everything down.

**Do NOT register MCP servers via `claude mcp add`, settings files, or any other built-in registration mechanism.** That defeats the entire purpose. Instead, declare servers in `mcp-registry.json` and invoke them through this CLI — connect on demand, use, disconnect. Zero background resource consumption.

Think of the registry as a "skill index" for MCP servers — each entry has a `when` field that describes exactly when to use that server, and tool summaries so you know what's available without connecting. This CLI is the bridge between the registry and the actual server.

## Workflow

```
1. Read registry    →  npx mcp-client-utils --registry
2. Match task       →  Find server whose `when` field matches the current task
3. Call tool        →  npx mcp-client-utils --server <name> call <tool> '<json>'
4. Done             →  Connection closes automatically (ephemeral) or stays in daemon (keep-alive)
```

**Early exit**: If you read the registry and no server matches the task, AND the user hasn't provided a URL for ad-hoc connection — stop here. This skill can't help. Don't try to install packages, use `curl` with raw JSON-RPC, or find alternative approaches. Just tell the user the requested MCP server isn't in the registry.

If the server you need is NOT in the registry but the user provided a URL, use ad-hoc mode to connect directly.

## Registry format

The registry lives at `.claude/mcp-registry.json` (searched upward from cwd). Example:

```json
{
  "servers": {
    "figma": {
      "description": "Figma design file access",
      "when": "User needs design files, assets, tokens, or Figma data",
      "transport": { "type": "stdio", "target": "npx", "args": ["-y", "figma-mcp-server"] },
      "lifecycle": "keep-alive",
      "tools": [
        { "name": "get_design_tokens", "description": "Extract design tokens (colors, typography, spacing)" },
        { "name": "export_assets", "description": "Export assets (PNG, SVG, PDF) from a Figma file" }
      ]
    },
    "screenshot": {
      "description": "Take screenshots of URLs",
      "when": "User wants to capture a screenshot of a webpage",
      "transport": { "type": "stdio", "target": "npx", "args": ["-y", "screenshot-mcp-server"] },
      "tools": [
        { "name": "take_screenshot", "description": "Capture a screenshot of a URL, returns base64 PNG" }
      ]
    }
  }
}
```

Key fields:
- **`when`** — trigger condition. Match this against the current task to decide if you need this server.
- **`tools`** — optional summaries. Helps decide without connecting. If omitted, use `--server <name> tools` to discover at runtime.
- **`lifecycle`** — `"ephemeral"` (default): connect per call, disconnect after. `"keep-alive"`: daemon maintains the connection for multi-call sessions.

## CLI reference

```bash
# Discovery
npx mcp-client-utils --registry                           # List all registered servers and their tools

# Tool operations (registry-based)
npx mcp-client-utils --server <name> tools                # Full tool schemas (use when param names are unclear)
npx mcp-client-utils --server <name> call <tool> '<json>' # Call a tool
npx mcp-client-utils --server <name> info                 # Server metadata
npx mcp-client-utils --server <name> resources             # List resources
npx mcp-client-utils --server <name> read <uri>            # Read a resource
npx mcp-client-utils --server <name> prompts               # List prompts
npx mcp-client-utils --server <name> prompt <name> '<json>' # Get a prompt
npx mcp-client-utils --server <name> templates             # List resource templates

# Ad-hoc direct connection (server not in registry)
npx mcp-client-utils --stdio "<cmd> [args]" -- <command>
npx mcp-client-utils --http <url> -- <command>
npx mcp-client-utils --sse <url> -- <command>

# Daemon (for keep-alive servers with multiple sequential calls)
npx mcp-client-utils daemon start
npx mcp-client-utils daemon status
npx mcp-client-utils daemon stop
```

## When to start the daemon

For `keep-alive` servers where you plan multiple sequential calls (e.g. list_tables → describe_table → query), start the daemon first to reuse the connection:

```bash
npx mcp-client-utils daemon start
npx mcp-client-utils --server postgres call list_tables '{}'
npx mcp-client-utils --server postgres call describe_table '{"table": "users"}'
npx mcp-client-utils --server postgres call query '{"sql": "SELECT * FROM users LIMIT 10"}'
npx mcp-client-utils daemon stop
```

For single calls or ephemeral servers, skip the daemon — the CLI handles connection/disconnection automatically.

## Schema reference

Full registry schema: `skills/mcp-lazy-cli/mcp-registry.schema.json`
