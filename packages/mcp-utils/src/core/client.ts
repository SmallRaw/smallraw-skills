import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ContentItem } from "../types.js";

export function printContent(content: ContentItem[]): void {
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

export class McpClient {
  private client: Client;
  private connected = false;

  constructor() {
    this.client = new Client({ name: "mcp-utils", version: "1.0.0" });
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

  async callTool(name: string, args?: Record<string, unknown>): Promise<void> {
    const params: { name: string; arguments?: Record<string, unknown> } = { name };
    if (args && Object.keys(args).length > 0) params.arguments = args;
    const result = await this.client.callTool(params);
    if (result.isError) {
      const content = result.content as ContentItem[] | undefined;
      const msg = content?.[0]?.text ?? "Unknown error";
      console.error(`Tool error: ${msg}`);
      process.exit(1);
    }
    printContent(result.content as ContentItem[]);
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
}
