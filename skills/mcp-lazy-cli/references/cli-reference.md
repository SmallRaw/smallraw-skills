# MCP Lazy CLI — Full Command Reference

## Discovery

```bash
npx mcp-client-utils --registry                           # List all registered servers and their tools
```

## Tool operations (registry-based)

```bash
npx mcp-client-utils --server <name> tools                # Full tool schemas (use when param names are unclear)
npx mcp-client-utils --server <name> call <tool> '<json>' # Call a tool
npx mcp-client-utils --server <name> info                 # Server metadata
npx mcp-client-utils --server <name> resources             # List resources
npx mcp-client-utils --server <name> read <uri>            # Read a resource
npx mcp-client-utils --server <name> prompts               # List prompts
npx mcp-client-utils --server <name> prompt <name> '<json>' # Get a prompt
npx mcp-client-utils --server <name> templates             # List resource templates
```

## Ad-hoc direct connection (server not in registry)

```bash
npx mcp-client-utils --stdio "<cmd> [args]" -- <command>
npx mcp-client-utils --http <url> -- <command>
npx mcp-client-utils --sse <url> -- <command>
```

## Daemon (for keep-alive servers)

```bash
npx mcp-client-utils daemon start
npx mcp-client-utils daemon status
npx mcp-client-utils daemon stop
```

### Daemon usage example

For `keep-alive` servers where you plan multiple sequential calls (e.g. list_tables -> describe_table -> query), start the daemon first to reuse the connection:

```bash
npx mcp-client-utils daemon start
npx mcp-client-utils --server postgres call list_tables '{}'
npx mcp-client-utils --server postgres call describe_table '{"table": "users"}'
npx mcp-client-utils --server postgres call query '{"sql": "SELECT * FROM users LIMIT 10"}'
npx mcp-client-utils daemon stop
```

For single calls or ephemeral servers, skip the daemon — the CLI handles connection/disconnection automatically.
