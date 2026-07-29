---
name: mcp-lazy-cli
description: "Use when the user wants to invoke MCP tools, connect to MCP servers, check the mcp-registry, or manage the MCP daemon."
allowed-tools:
  - Bash
  - Read
---

# MCP Lazy CLI

On-demand MCP server invocation via `npx mcp-client-utils`. Servers are declared in `.claude/mcp-registry.json` and connected only when needed — no preloading, and no background process unless a keep-alive server uses the daemon.

## Core Rules

1. **Never register MCP servers** — Do NOT use `claude mcp add`, settings files, or any built-in registration. All servers go in `mcp-registry.json` and are invoked through this CLI.
2. **Registry-first** — Always read the registry (`npx mcp-client-utils --registry`) before doing anything. Match the task against each server's `when` field.
3. **Early exit on no match** — If no registry server matches AND the user hasn't provided an endpoint or stdio command for ad-hoc connection, stop. Don't try alternative approaches (curl, raw JSON-RPC, package installs).
4. **Ad-hoc fallback** — If the server isn't in the registry but the user provided an endpoint or stdio command, use `--stdio`, `--http`, or `--sse` for direct connection.
5. **Daemon only for multi-call keep-alive** — Start the daemon (`daemon start`) only for `lifecycle: "keep-alive"` servers where you plan multiple sequential calls. Single calls and ephemeral servers don't need it.

## Gotchas

1. **JSON args must be single-quoted** — `call <tool> '{"key": "value"}'`. Double quotes around the JSON will break shell parsing.
2. **Registry search is upward** — `.claude/mcp-registry.json` is found by walking up from cwd. If you're in a subdirectory, it still works. If no registry exists anywhere above cwd, `--registry` exits non-zero; report that the registry is missing.
3. **`tools` in registry are summaries only** — They don't include parameter schemas. When param names or types are unclear, call `--server <name> tools` to get the full schema before calling.
4. **Ephemeral is the default lifecycle** — If `lifecycle` is omitted, the server is ephemeral. Don't start the daemon for ephemeral servers; it won't help.
5. **Stop the daemon when finished** — Idle server connections are evicted automatically, but the daemon process keeps running. Use `daemon stop` when the multi-call session is done.
6. **npx cold-start latency** — First invocation downloads the package. If the user reports slowness on first call, this is expected — subsequent calls are fast.
7. **Don't invent tool names** — If you're unsure what tools a server exposes, call `--server <name> tools` to discover. Don't guess tool names from the description.
8. **Protocol negotiation is automatic** — Do not choose an MCP protocol version during normal use. The client negotiates MCP `2026-07-28` and falls back to legacy automatically. Set `transport.protocol` only to troubleshoot an older server (`"legacy"`) or require a known modern server (`"2026-07-28"`).
9. **Treat the registry as executable configuration** — A stdio entry can launch its `target` with `args`, and HTTP/SSE entries send requests to their targets. Before first use, inspect the selected transport and invoke it only when the registry and target are trusted or explicitly approved by the user.

## Quick Reference

```bash
npx mcp-client-utils --registry                           # Read registry
npx mcp-client-utils --server <name> call <tool> '<json>' # Call a tool
npx mcp-client-utils --server <name> tools                # Full tool schemas
```

## References

- `references/cli-reference.md` — full CLI command listing, ad-hoc modes, daemon usage
- `references/registry-format.md` — registry JSON format, field semantics, example
- `references/mcp-registry.schema.json` — full JSON Schema for `mcp-registry.json`
