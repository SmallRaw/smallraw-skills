export type DaemonMethod =
  | "callTool"
  | "listTools"
  | "listResources"
  | "listResourceTemplates"
  | "readResource"
  | "listPrompts"
  | "getPrompt"
  | "serverInfo"
  | "status"
  | "stop";

export interface DaemonRequest {
  id: string;
  method: DaemonMethod;
  params: {
    server?: string;
    name?: string;
    args?: Record<string, unknown>;
    uri?: string;
  };
}

export interface DaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

export interface ServerStatus {
  name: string;
  connected: boolean;
  lastUsedAt?: number;
}

export interface DaemonStatus {
  pid: number;
  startedAt: number;
  socketPath: string;
  servers: ServerStatus[];
}
