# MCP Registry Format

The registry lives at `.claude/mcp-registry.json` (searched upward from cwd).

## Example

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

## Key fields

- **`when`** — trigger condition. Match this against the current task to decide if you need this server.
- **`tools`** — optional summaries. Helps decide without connecting. If omitted, use `--server <name> tools` to discover at runtime.
- **`lifecycle`** — `"ephemeral"` (default): connect per call, disconnect after. `"keep-alive"`: daemon maintains the connection for multi-call sessions.

## Schema

Full JSON Schema: `references/mcp-registry.schema.json`
