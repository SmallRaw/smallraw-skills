// INPUT: MCP registry entries, tool schemas, and command context
// OUTPUT: Compact operator guidance with copyable next commands and JSON templates
// POS: Agent-facing formatting helpers for mcp-client-utils

import type { Registry, ServerEntry } from "./types.js";

export interface ToolLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export function buildJsonTemplate(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return {};
  const value = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    enum?: unknown[];
    default?: unknown;
  };

  if (value.default !== undefined) return value.default;
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0];

  switch (value.type) {
    case "string":
      return "<string>";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return value.items ? [buildJsonTemplate(value.items)] : [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value.properties ?? {})) {
        out[key] = buildJsonTemplate(child);
      }
      return out;
    }
    default:
      if (value.properties) {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value.properties)) {
          out[key] = buildJsonTemplate(child);
        }
        return out;
      }
      return "<value>";
  }
}

export function formatRegistryGuide(registry: Registry): string {
  const lines = ["# MCP Registry", ""];
  const entries = Object.entries(registry.servers);
  if (entries.length === 0) {
    lines.push("No MCP servers registered.", "");
    return lines.join("\n");
  }

  for (const [name, entry] of entries) {
    lines.push(`## ${name} - ${entry.description}`);
    if (entry.when) lines.push(`When: ${entry.when}`);
    lines.push(`Transport: ${entry.transport.type} ${entry.transport.target}`);
    if (entry.tools?.length) {
      lines.push("Tools:");
      for (const tool of entry.tools.slice(0, 8)) {
        lines.push(`- ${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
      }
    }
    appendServerNext(lines, name, entry);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatToolsGuide(tools: ToolLike[], serverName?: string): string {
  const lines = ["# MCP Tools", ""];
  if (tools.length === 0) {
    lines.push("No tools exposed by this MCP server.", "");
    return lines.join("\n");
  }

  for (const tool of tools) {
    lines.push(`## ${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
    const template = buildJsonTemplate(tool.inputSchema);
    const json = JSON.stringify(template, null, 2);
    lines.push("Call:");
    lines.push(commandForTool(tool.name, serverName, json));
    if (json !== "{}") {
      lines.push("Argument template:");
      lines.push("```json");
      lines.push(json);
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatToolCallGuide(tools: ToolLike[], serverName?: string): string {
  const lines = ["# MCP Tool Calls", "", "Choose one tool and call it with a JSON argument object:", ""];
  for (const tool of tools.slice(0, 20)) {
    const template = JSON.stringify(buildJsonTemplate(tool.inputSchema));
    lines.push(`- ${commandForTool(tool.name, serverName, template)}${tool.description ? ` # ${tool.description}` : ""}`);
  }
  return lines.join("\n");
}

function appendServerNext(lines: string[], name: string, entry: ServerEntry): void {
  lines.push("Next:");
  lines.push(`- mcp-client-utils --server ${name} tools --compact`);
  if (entry.tools?.[0]) {
    lines.push(`- mcp-client-utils --server ${name} call ${entry.tools[0].name} '{}'`);
  }
  if (entry.resources?.length) lines.push(`- mcp-client-utils --server ${name} resources`);
  if (entry.prompts?.length) lines.push(`- mcp-client-utils --server ${name} prompts`);
}

function commandForTool(toolName: string, serverName: string | undefined, json: string): string {
  if (serverName) return `mcp-client-utils --server ${serverName} call ${toolName} '${json}'`;
  return `mcp-client-utils call ${toolName} '${json}'`;
}
