export const USAGE = `mcp-client-utils — Generic MCP client for AI agents (stdio / http / sse)

Usage:
  mcp-client-utils --server <name> <command> [args]           Use server from registry
  mcp-client-utils --registry [path]                          Show registry contents
  mcp-client-utils --stdio "<cmd> [args]" -- <command>        Ad-hoc stdio connection
  mcp-client-utils --http <url> -- <command>                  Ad-hoc HTTP connection
  mcp-client-utils --sse <url> -- <command>                   Ad-hoc SSE connection

Registry mode (reads mcp-registry.json, searches upward from cwd):
  --server <name>          Connect to a named server from the registry
  --registry [path]        Print registry (all servers & their tool summaries)

Ad-hoc mode:
  --stdio "<command> [args...]"    Connect to a stdio MCP server
  --http <url>                     Connect to an HTTP MCP server
  --sse <url>                      Connect to an SSE MCP server

Commands:
  info                           Server info & capabilities
  tools                          List all tools (full schema)
  call <name> [json-args]        Call a tool
  resources                      List resources
  templates                      List resource templates
  read <uri>                     Read a resource
  prompts                        List prompts
  prompt <name> [json-args]      Get a prompt

Daemon:
  mcp-client-utils daemon start           Start daemon for keep-alive servers
  mcp-client-utils daemon stop            Stop daemon
  mcp-client-utils daemon status          Show daemon status and connections

Examples:
  # Registry mode
  mcp-client-utils --server pencil tools
  mcp-client-utils --server pencil call get_editor_state '{"include_schema":false}'
  mcp-client-utils --registry

  # Ad-hoc mode
  mcp-client-utils --stdio "/path/to/server --app desktop" -- tools
  mcp-client-utils --http http://localhost:3000/mcp -- call my_tool '{"key":"val"}'
  mcp-client-utils --sse http://localhost:3000/sse -- tools
`;
