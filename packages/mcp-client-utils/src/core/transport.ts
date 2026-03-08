import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { TransportConfig } from "../types.js";

export function createTransport(config: TransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.target,
        args: config.args ?? [],
        env: process.env as Record<string, string>,
      });

    case "http":
      return new StreamableHTTPClientTransport(new URL(config.target));

    case "sse":
      return new SSEClientTransport(new URL(config.target));

    default:
      console.error(`Unknown transport: ${config.type}. Use: stdio, http, sse`);
      process.exit(1);
  }
}
