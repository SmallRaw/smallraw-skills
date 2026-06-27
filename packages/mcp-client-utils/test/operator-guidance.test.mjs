import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRegistryGuide,
  formatToolsGuide,
  buildJsonTemplate
} from "../dist/mcp-utils.js";

test("formatRegistryGuide prints compact servers and next commands", () => {
  const output = formatRegistryGuide({
    servers: {
      pencil: {
        description: "Pencil editor MCP",
        when: "Need editor state",
        transport: { type: "stdio", target: "pencil-mcp" },
        tools: [{ name: "get_editor_state", description: "Read editor state" }]
      }
    }
  });

  assert.match(output, /# MCP Registry/);
  assert.match(output, /pencil - Pencil editor MCP/);
  assert.match(output, /When: Need editor state/);
  assert.match(output, /mcp-client-utils --server pencil tools --compact/);
  assert.match(output, /mcp-client-utils --server pencil call get_editor_state/);
});

test("buildJsonTemplate creates nested JSON argument template", () => {
  const template = buildJsonTemplate({
    type: "object",
    properties: {
      include_schema: { type: "boolean" },
      cursor: { type: "string" },
      limits: {
        type: "object",
        properties: {
          max: { type: "number" }
        }
      }
    },
    required: ["include_schema"]
  });

  assert.deepEqual(template, {
    include_schema: false,
    cursor: "<string>",
    limits: {
      max: 0
    }
  });
});

test("formatToolsGuide supports compact output and call examples", () => {
  const output = formatToolsGuide([
    {
      name: "get_editor_state",
      description: "Read editor state",
      inputSchema: {
        type: "object",
        properties: {
          include_schema: { type: "boolean" }
        }
      }
    }
  ], "pencil");

  assert.match(output, /# MCP Tools/);
  assert.match(output, /get_editor_state - Read editor state/);
  assert.match(output, /mcp-client-utils --server pencil call get_editor_state/);
  assert.match(output, /"include_schema": false/);
});
