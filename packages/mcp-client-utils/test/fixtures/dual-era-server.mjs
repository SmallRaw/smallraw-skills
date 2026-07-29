import { createInterface } from "node:readline";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const legacyOnly = process.argv.includes("--legacy-only");

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;

  if (message.method === "server/discover") {
    if (legacyOnly) {
      respondError(message.id, -32601, "Method not found");
      return;
    }
    respond(message.id, {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private",
      supportedVersions: [MODERN_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "dual-era-test-server",
          version: "1.0.0",
        },
      },
    });
    return;
  }

  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: {
        name: "dual-era-test-server",
        version: "1.0.0",
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    const modern = message.params?._meta?.[PROTOCOL_VERSION_META_KEY] === MODERN_PROTOCOL_VERSION;
    respond(message.id, {
      ...(modern
        ? { resultType: "complete", ttlMs: 0, cacheScope: "private" }
        : {}),
      tools: [{
        name: modern ? "modern_tool" : "legacy_tool",
        description: "Protocol negotiation test tool",
        inputSchema: { type: "object" },
      }],
    });
  }
});
