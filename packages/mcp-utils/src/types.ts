export interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface TransportConfig {
  type: "stdio" | "http" | "sse";
  target: string;
  args?: string[];
}

export interface ServerEntry {
  description: string;
  when?: string;
  lifecycle?: "keep-alive" | "ephemeral";
  transport: TransportConfig;
  tools?: Array<{ name: string; description: string }>;
  resources?: Array<{ name: string; description?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  notes?: string;
}

export interface Registry {
  servers: Record<string, ServerEntry>;
}
