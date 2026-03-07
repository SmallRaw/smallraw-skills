#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// --- Types ---

interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface TransportConfig {
  type: "stdio" | "http" | "sse";
  target: string;
  args?: string[];
}

interface ServerEntry {
  description: string;
  when?: string;
  transport: TransportConfig;
  tools?: Array<{ name: string; description: string }>;
  resources?: Array<{ name: string; description?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  notes?: string;
}

interface Registry {
  servers: Record<string, ServerEntry>;
}

// --- Registry ---

function findRegistry(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    // Check: ./mcp-registry.json
    const root = resolve(dir, "mcp-registry.json");
    if (existsSync(root)) return root;
    // Check: ./.claude/mcp-registry.json
    const dotClaude = resolve(dir, ".claude", "mcp-registry.json");
    if (existsSync(dotClaude)) return dotClaude;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadRegistry(registryPath: string): Registry {
  const raw = readFileSync(registryPath, "utf-8");
  return JSON.parse(raw) as Registry;
}

// --- Transport Factory ---

function createTransport(config: TransportConfig): Transport {
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

// --- MCP Client ---

class McpClient {
  private client: Client;
  private connected = false;

  constructor() {
    this.client = new Client({ name: "mcp-core", version: "1.0.0" });
  }

  async connect(transport: Transport): Promise<void> {
    await this.client.connect(transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  async serverInfo(): Promise<void> {
    const info = this.client.getServerVersion();
    const caps = this.client.getServerCapabilities();
    console.log(JSON.stringify({ server: info, capabilities: caps }, null, 2));
  }

  async listTools(): Promise<void> {
    const result = await this.client.listTools();
    console.log(JSON.stringify(result.tools, null, 2));
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<void> {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      const content = result.content as ContentItem[] | undefined;
      const msg = content?.[0]?.text ?? "Unknown error";
      console.error(`Tool error: ${msg}`);
      process.exit(1);
    }
    this.printContent(result.content as ContentItem[]);
  }

  async listResources(): Promise<void> {
    const result = await this.client.listResources();
    console.log(JSON.stringify(result.resources, null, 2));
  }

  async listResourceTemplates(): Promise<void> {
    const result = await this.client.listResourceTemplates();
    console.log(JSON.stringify(result.resourceTemplates, null, 2));
  }

  async readResource(uri: string): Promise<void> {
    const result = await this.client.readResource({ uri });
    for (const item of result.contents) {
      if ("text" in item && item.text) {
        try {
          console.log(JSON.stringify(JSON.parse(item.text), null, 2));
        } catch {
          console.log(item.text);
        }
      } else if ("blob" in item && item.blob) {
        console.log(`[Binary: ${item.mimeType ?? "unknown"}]`);
      }
    }
  }

  async listPrompts(): Promise<void> {
    const result = await this.client.listPrompts();
    console.log(JSON.stringify(result.prompts, null, 2));
  }

  async getPrompt(name: string, args: Record<string, string> = {}): Promise<void> {
    const result = await this.client.getPrompt({ name, arguments: args });
    console.log(JSON.stringify(result, null, 2));
  }

  private printContent(content: ContentItem[]): void {
    if (!content?.length) return;
    for (const item of content) {
      if (item.type === "text" && item.text) {
        try {
          console.log(JSON.stringify(JSON.parse(item.text), null, 2));
        } catch {
          console.log(item.text);
        }
      } else if (item.type === "image") {
        console.log(`[Image: ${item.mimeType ?? "unknown"}, ${item.data?.length ?? 0} bytes base64]`);
      } else {
        console.log(JSON.stringify(item, null, 2));
      }
    }
  }
}

// --- CLI ---

const USAGE = `mcp-core — Generic MCP client for AI agents (stdio / http / sse)

Usage:
  mcp-core --server <name> <command> [args]           Use server from registry
  mcp-core --registry [path]                          Show registry contents
  mcp-core --transport <type> --target <t> [--args ...] -- <command> [args]   Manual mode

Registry mode (reads mcp-registry.json, searches upward from cwd):
  --server <name>          Connect to a named server from the registry
  --registry [path]        Print registry (all servers & their tool summaries)

Manual mode:
  --transport stdio|http|sse
  --target <path-or-url>
  --args <arg1> <arg2> ... (for stdio, terminated by --)

Commands:
  info                           Server info & capabilities
  tools                          List all tools (full schema)
  call <name> [json-args]        Call a tool
  resources                      List resources
  templates                      List resource templates
  read <uri>                     Read a resource
  prompts                        List prompts
  prompt <name> [json-args]      Get a prompt

Examples:
  # Registry mode — AI just needs server name
  mcp-core --server pencil tools
  mcp-core --server pencil call get_editor_state '{"include_schema":false}'

  # Show what servers are available
  mcp-core --registry

  # Manual mode
  mcp-core --transport stdio --target /path/to/server --args --app desktop -- tools
  mcp-core --transport http --target http://localhost:3000/mcp -- call my_tool '{"key":"val"}'
`;

interface ParsedArgs {
  mode: "registry" | "server" | "manual";
  registryPath?: string;
  serverName?: string;
  transportType?: string;
  target?: string;
  serverArgs: string[];
  commandArgs: string[];
}

function parseCliArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const result: ParsedArgs = { mode: "manual", serverArgs: [], commandArgs: [] };

  if (!argv.length) {
    console.log(USAGE);
    process.exit(0);
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--registry") {
      result.mode = "registry";
      // optional path argument
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        result.registryPath = argv[++i];
      }
      i++;
    } else if (arg === "--server" || arg === "-s") {
      result.mode = "server";
      result.serverName = argv[++i];
      i++;
      // rest are command args
      result.commandArgs = argv.slice(i);
      break;
    } else if (arg === "--transport") {
      result.transportType = argv[++i];
      i++;
    } else if (arg === "--target") {
      result.target = argv[++i];
      i++;
    } else if (arg === "--args") {
      i++;
      while (i < argv.length && argv[i] !== "--") {
        result.serverArgs.push(argv[i]);
        i++;
      }
      if (i < argv.length && argv[i] === "--") {
        i++;
        result.commandArgs = argv.slice(i);
        break;
      }
    } else if (arg === "--") {
      i++;
      result.commandArgs = argv.slice(i);
      break;
    } else {
      // First unrecognized arg starts command
      result.commandArgs = argv.slice(i);
      break;
    }
  }

  return result;
}

function parseJsonArg(arg: string | undefined): Record<string, unknown> {
  if (!arg) return {};
  try {
    return JSON.parse(arg);
  } catch {
    console.error(`Invalid JSON argument: ${arg}`);
    process.exit(1);
  }
}

async function runCommand(client: McpClient, commandArgs: string[]): Promise<void> {
  if (!commandArgs.length) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = commandArgs[0];

  switch (command) {
    case "info":
      await client.serverInfo();
      break;

    case "tools":
      await client.listTools();
      break;

    case "call": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: call <tool-name> [json-args]"); process.exit(1); }
      await client.callTool(name, parseJsonArg(commandArgs[2]));
      break;
    }

    case "resources":
      await client.listResources();
      break;

    case "templates":
      await client.listResourceTemplates();
      break;

    case "read": {
      const uri = commandArgs[1];
      if (!uri) { console.error("Usage: read <resource-uri>"); process.exit(1); }
      await client.readResource(uri);
      break;
    }

    case "prompts":
      await client.listPrompts();
      break;

    case "prompt": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: prompt <name> [json-args]"); process.exit(1); }
      await client.getPrompt(name, parseJsonArg(commandArgs[2]) as Record<string, string>);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function main() {
  const parsed = parseCliArgs();

  // --- Registry mode: just print the registry ---
  if (parsed.mode === "registry") {
    const regPath = parsed.registryPath
      ? resolve(parsed.registryPath)
      : findRegistry(process.cwd());

    if (!regPath || !existsSync(regPath)) {
      console.error("No mcp-registry.json found. Create one or specify --registry <path>.");
      process.exit(1);
    }

    const registry = loadRegistry(regPath);
    console.log(JSON.stringify(registry, null, 2));
    return;
  }

  // --- Resolve transport config ---
  let transportConfig: TransportConfig;

  if (parsed.mode === "server") {
    if (!parsed.serverName) {
      console.error("Usage: --server <name> <command>");
      process.exit(1);
    }

    const regPath = findRegistry(process.cwd());
    if (!regPath) {
      console.error("No mcp-registry.json found. Cannot resolve server name.");
      process.exit(1);
    }

    const registry = loadRegistry(regPath);
    const entry = registry.servers[parsed.serverName];
    if (!entry) {
      const available = Object.keys(registry.servers).join(", ");
      console.error(`Server "${parsed.serverName}" not in registry. Available: ${available}`);
      process.exit(1);
    }

    transportConfig = entry.transport;
  } else {
    // Manual mode
    if (!parsed.transportType || !parsed.target) {
      console.log(USAGE);
      process.exit(1);
    }
    transportConfig = {
      type: parsed.transportType as TransportConfig["type"],
      target: parsed.target,
      args: parsed.serverArgs,
    };
  }

  // --- Connect and run ---
  const transport = createTransport(transportConfig);
  const client = new McpClient();
  await client.connect(transport);

  try {
    await runCommand(client, parsed.commandArgs);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
