# mcp-utils Daemon Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add daemon mode to mcp-utils so `lifecycle: "keep-alive"` servers maintain persistent connections via a background process.

**Architecture:** CLI detects server lifecycle from registry. Ephemeral servers use existing direct-connect logic. Keep-alive servers route through a daemon process (Unix socket IPC) that holds MCP client connections in a pool. Daemon auto-starts on first keep-alive request, idle-evicts after 5 minutes.

**Tech Stack:** Node.js `net` module (Unix socket), `child_process.spawn` (detached daemon), existing `@modelcontextprotocol/sdk`.

---

### Task 1: Add `lifecycle` field to types and schema

**Files:**
- Modify: `packages/mcp-utils/src/index.ts:25-33` (ServerEntry interface)
- Modify: `packages/mcp-utils/mcp-registry.schema.json:19-54` (server definition)

**Step 1: Add lifecycle to ServerEntry type**

In `packages/mcp-utils/src/index.ts`, add `lifecycle` to `ServerEntry`:

```typescript
interface ServerEntry {
  description: string;
  when?: string;
  lifecycle?: "keep-alive" | "ephemeral";
  transport: TransportConfig;
  tools?: Array<{ name: string; description: string }>;
  resources?: Array<{ name: string; description?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  notes?: string;
}
```

**Step 2: Add lifecycle to JSON schema**

In `packages/mcp-utils/mcp-registry.schema.json`, add to the `server` definition's properties:

```json
"lifecycle": {
  "type": "string",
  "enum": ["keep-alive", "ephemeral"],
  "default": "ephemeral",
  "description": "keep-alive: daemon holds connection open. ephemeral (default): connect per call."
}
```

**Step 3: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds, no errors.

**Step 4: Commit**

```bash
git add packages/mcp-utils/src/index.ts packages/mcp-utils/mcp-registry.schema.json
git commit -m "feat(mcp-utils): add lifecycle field to server config"
```

---

### Task 2: Create daemon protocol types

**Files:**
- Create: `packages/mcp-utils/src/daemon/protocol.ts`

**Step 1: Create the protocol file**

```typescript
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
```

**Step 2: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds (esbuild bundles all files).

**Step 3: Commit**

```bash
git add packages/mcp-utils/src/daemon/protocol.ts
git commit -m "feat(mcp-utils): add daemon protocol types"
```

---

### Task 3: Create daemon paths utility

**Files:**
- Create: `packages/mcp-utils/src/daemon/paths.ts`

**Step 1: Create the paths file**

```typescript
import { createHash } from "crypto";
import { join } from "path";
import { homedir } from "os";

function daemonDir(): string {
  return join(homedir(), ".mcp-utils", "daemon");
}

function configKey(registryPath: string): string {
  return createHash("sha1").update(registryPath).digest("hex").slice(0, 12);
}

export function getSocketPath(registryPath: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mcp-utils-daemon-${configKey(registryPath)}`;
  }
  return join(daemonDir(), `daemon-${configKey(registryPath)}.sock`);
}

export function getMetadataPath(registryPath: string): string {
  return join(daemonDir(), `daemon-${configKey(registryPath)}.json`);
}

export function getLogPath(registryPath: string): string {
  return join(daemonDir(), `daemon-${configKey(registryPath)}.log`);
}
```

**Step 2: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/mcp-utils/src/daemon/paths.ts
git commit -m "feat(mcp-utils): add daemon paths utility"
```

---

### Task 4: Create daemon host (server-side process)

**Files:**
- Create: `packages/mcp-utils/src/daemon/host.ts`

This is the daemon process itself. It:
1. Reads registry, finds all `keep-alive` servers
2. Creates a Unix socket server
3. Maintains a connection pool of MCP clients (lazy-connect on first request)
4. Handles incoming requests from CLI, routes to the right MCP client
5. Idle-evicts servers not used in 5 minutes (checked every 30s)
6. Writes metadata file on startup
7. Cleans up socket + metadata on exit

**Step 1: Create the host file**

```typescript
import net from "net";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DaemonRequest, DaemonResponse, DaemonStatus, ServerStatus } from "./protocol.js";

interface TransportConfig {
  type: "stdio" | "http" | "sse";
  target: string;
  args?: string[];
}

interface ServerEntry {
  description: string;
  lifecycle?: "keep-alive" | "ephemeral";
  transport: TransportConfig;
}

interface Registry {
  servers: Record<string, ServerEntry>;
}

interface ManagedServer {
  name: string;
  config: TransportConfig;
  client: Client | null;
  connected: boolean;
  lastUsedAt: number;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

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
      throw new Error(`Unknown transport: ${config.type}`);
  }
}

export async function runDaemonHost(
  registryPath: string,
  socketPath: string,
  metadataPath: string
): Promise<void> {
  const raw = readFileSync(registryPath, "utf-8");
  const registry = JSON.parse(raw) as Registry;

  // Find keep-alive servers
  const managed = new Map<string, ManagedServer>();
  for (const [name, entry] of Object.entries(registry.servers)) {
    if (entry.lifecycle === "keep-alive") {
      managed.set(name, {
        name,
        config: entry.transport,
        client: null,
        connected: false,
        lastUsedAt: Date.now(),
      });
    }
  }

  if (managed.size === 0) {
    console.error("No keep-alive servers found in registry.");
    process.exit(1);
  }

  // Ensure socket directory exists
  const socketDir = dirname(socketPath);
  mkdirSync(socketDir, { recursive: true });

  // Clean up stale socket
  if (process.platform !== "win32") {
    try { unlinkSync(socketPath); } catch {}
  }

  // Lazy-connect to a managed server
  async function ensureConnected(server: ManagedServer): Promise<Client> {
    if (server.client && server.connected) {
      server.lastUsedAt = Date.now();
      return server.client;
    }
    const client = new Client({ name: "mcp-utils-daemon", version: "1.0.0" });
    const transport = createTransport(server.config);
    await client.connect(transport);
    server.client = client;
    server.connected = true;
    server.lastUsedAt = Date.now();
    return client;
  }

  // Disconnect a server
  async function disconnectServer(server: ManagedServer): Promise<void> {
    if (server.client && server.connected) {
      try { await server.client.close(); } catch {}
      server.client = null;
      server.connected = false;
    }
  }

  // Handle a single request
  async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
    const { id, method, params } = req;

    try {
      if (method === "status") {
        const servers: ServerStatus[] = Array.from(managed.values()).map((s) => ({
          name: s.name,
          connected: s.connected,
          lastUsedAt: s.lastUsedAt,
        }));
        const result: DaemonStatus = {
          pid: process.pid,
          startedAt,
          socketPath,
          servers,
        };
        return { id, ok: true, result };
      }

      if (method === "stop") {
        // Respond first, then shutdown
        setTimeout(() => shutdown(), 100);
        return { id, ok: true, result: true };
      }

      // All other methods require a server name
      const serverName = params.server;
      if (!serverName) {
        return { id, ok: false, error: { message: "Missing server name" } };
      }

      const server = managed.get(serverName);
      if (!server) {
        const available = Array.from(managed.keys()).join(", ");
        return { id, ok: false, error: { message: `Server "${serverName}" not managed by daemon. Available: ${available}` } };
      }

      const client = await ensureConnected(server);

      switch (method) {
        case "listTools": {
          const result = await client.listTools();
          return { id, ok: true, result: result.tools };
        }
        case "callTool": {
          const toolParams: { name: string; arguments?: Record<string, unknown> } = { name: params.name! };
          if (params.args && Object.keys(params.args).length > 0) toolParams.arguments = params.args;
          const result = await client.callTool(toolParams);
          return { id, ok: true, result };
        }
        case "listResources": {
          const result = await client.listResources();
          return { id, ok: true, result: result.resources };
        }
        case "listResourceTemplates": {
          const result = await client.listResourceTemplates();
          return { id, ok: true, result: result.resourceTemplates };
        }
        case "readResource": {
          const result = await client.readResource({ uri: params.uri! });
          return { id, ok: true, result: result.contents };
        }
        case "listPrompts": {
          const result = await client.listPrompts();
          return { id, ok: true, result: result.prompts };
        }
        case "getPrompt": {
          const result = await client.getPrompt({
            name: params.name!,
            arguments: (params.args ?? {}) as Record<string, string>,
          });
          return { id, ok: true, result };
        }
        case "serverInfo": {
          const info = client.getServerVersion();
          const caps = client.getServerCapabilities();
          return { id, ok: true, result: { server: info, capabilities: caps } };
        }
        default:
          return { id, ok: false, error: { message: `Unknown method: ${method}` } };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { id, ok: false, error: { message: msg } };
    }
  }

  // Create Unix socket server
  const startedAt = Date.now();
  const socketServer = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;

    const tryHandle = (): void => {
      if (handled) return;
      const trimmed = buffer.trim();
      if (!trimmed) return;
      let req: DaemonRequest;
      try {
        req = JSON.parse(trimmed) as DaemonRequest;
      } catch {
        return; // not complete JSON yet
      }
      handled = true;
      handleRequest(req).then((res) => {
        socket.write(JSON.stringify(res), () => socket.end());
      }).catch(() => socket.destroy());
    };

    socket.on("data", (chunk) => { buffer += chunk; tryHandle(); });
    socket.on("end", () => { if (!handled) tryHandle(); });
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    socketServer.once("error", reject);
    socketServer.listen(socketPath, () => {
      socketServer.off("error", reject);
      resolve();
    });
  });

  // Write metadata
  const metaDir = dirname(metadataPath);
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(metadataPath, JSON.stringify({
    pid: process.pid,
    socketPath,
    registryPath,
    startedAt,
  }, null, 2), "utf-8");

  // Idle eviction timer
  const idleTimer = setInterval(() => {
    const now = Date.now();
    for (const server of managed.values()) {
      if (server.connected && now - server.lastUsedAt > IDLE_TIMEOUT_MS) {
        disconnectServer(server).catch(() => {});
      }
    }
  }, IDLE_CHECK_INTERVAL_MS);
  idleTimer.unref();

  // Shutdown handler
  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(idleTimer);
    socketServer.close();
    for (const server of managed.values()) {
      await disconnectServer(server).catch(() => {});
    }
    // Cleanup files
    if (process.platform !== "win32") {
      try { unlinkSync(socketPath); } catch {}
    }
    try { unlinkSync(metadataPath); } catch {}
    process.exit(0);
  }

  process.once("SIGINT", () => shutdown());
  process.once("SIGTERM", () => shutdown());
}
```

**Step 2: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/mcp-utils/src/daemon/host.ts
git commit -m "feat(mcp-utils): add daemon host process"
```

---

### Task 5: Create daemon launcher

**Files:**
- Create: `packages/mcp-utils/src/daemon/launch.ts`

**Step 1: Create the launch file**

```typescript
import { spawn } from "child_process";
import { resolve } from "path";

export function launchDaemonDetached(
  registryPath: string,
  socketPath: string,
  metadataPath: string
): void {
  const cliEntry = resolve(process.argv[1]);
  const args = [
    ...process.execArgv,
    cliEntry,
    "daemon",
    "start",
    "--foreground",
    "--registry-path", registryPath,
    "--socket-path", socketPath,
    "--metadata-path", metadataPath,
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
}
```

**Step 2: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/mcp-utils/src/daemon/launch.ts
git commit -m "feat(mcp-utils): add daemon launcher"
```

---

### Task 6: Create daemon client (CLI-side)

**Files:**
- Create: `packages/mcp-utils/src/daemon/client.ts`

This is what the CLI uses to communicate with the daemon. It:
1. Connects to the Unix socket
2. Sends a DaemonRequest, receives a DaemonResponse
3. Auto-starts daemon if not running
4. Retries once on transport error (restart daemon)

**Step 1: Create the client file**

```typescript
import net from "net";
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { getSocketPath, getMetadataPath } from "./paths.js";
import { launchDaemonDetached } from "./launch.js";
import type { DaemonMethod, DaemonRequest, DaemonResponse } from "./protocol.js";

const DAEMON_TIMEOUT_MS = 30_000;

export class DaemonClient {
  private socketPath: string;
  private metadataPath: string;
  private registryPath: string;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
    this.socketPath = getSocketPath(registryPath);
    this.metadataPath = getMetadataPath(registryPath);
  }

  async invoke(method: DaemonMethod, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureDaemon();
    try {
      return await this.sendRequest(method, params);
    } catch (e) {
      if (isTransportError(e)) {
        await this.restartDaemon();
        return await this.sendRequest(method, params);
      }
      throw e;
    }
  }

  async status(): Promise<unknown> {
    try {
      return await this.sendRequest("status", {});
    } catch (e) {
      if (isTransportError(e)) return null;
      throw e;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.sendRequest("stop", {});
    } catch (e) {
      if (isTransportError(e)) return;
      throw e;
    }
  }

  private async ensureDaemon(): Promise<void> {
    if (await this.isResponsive()) return;
    this.startDaemon();
    await this.waitForReady();
  }

  private async restartDaemon(): Promise<void> {
    this.startDaemon();
    await this.waitForReady();
  }

  private startDaemon(): void {
    launchDaemonDetached(this.registryPath, this.socketPath, this.metadataPath);
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await this.isResponsive()) return;
      await delay(100);
    }
    throw new Error("Timeout waiting for mcp-utils daemon to start.");
  }

  private async isResponsive(): Promise<boolean> {
    try {
      await this.sendRequest("status", {});
      return true;
    } catch (e) {
      if (isTransportError(e)) return false;
      throw e;
    }
  }

  private sendRequest(method: DaemonMethod, params: Record<string, unknown>): Promise<unknown> {
    const request: DaemonRequest = { id: randomUUID(), method, params };
    const payload = JSON.stringify(request);

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      let buffer = "";

      socket.setTimeout(DAEMON_TIMEOUT_MS, () => {
        socket.destroy(Object.assign(new Error("Daemon request timed out"), { code: "ETIMEDOUT" }));
      });

      socket.on("connect", () => {
        socket.write(payload, (err) => {
          if (err && !settled) { settled = true; reject(err); }
        });
      });

      socket.on("data", (chunk) => { buffer += chunk.toString(); });

      socket.on("end", () => {
        if (settled) return;
        settled = true;
        const trimmed = buffer.trim();
        if (!trimmed) {
          const err = new Error("Empty daemon response");
          (err as NodeJS.ErrnoException).code = "ECONNRESET";
          return reject(err);
        }
        try {
          const parsed = JSON.parse(trimmed) as DaemonResponse;
          if (!parsed.ok) {
            return reject(new Error(parsed.error?.message ?? "Daemon error"));
          }
          resolve(parsed.result);
        } catch {
          const err = new Error("Failed to parse daemon response");
          (err as NodeJS.ErrnoException).code = "ECONNRESET";
          reject(err);
        }
      });

      socket.on("error", (err) => {
        if (!settled) { settled = true; reject(err); }
      });
    });
  }
}

function isTransportError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ECONNREFUSED" || code === "ENOENT" || code === "ETIMEDOUT" || code === "ECONNRESET";
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

**Step 2: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/mcp-utils/src/daemon/client.ts
git commit -m "feat(mcp-utils): add daemon client for CLI-side communication"
```

---

### Task 7: Integrate daemon into CLI entry point

**Files:**
- Modify: `packages/mcp-utils/src/index.ts`

This is the biggest change. We need to:
1. Add `daemon` command parsing (start/stop/status)
2. In `main()`, when server mode detects `lifecycle: "keep-alive"`, route through DaemonClient instead of direct connection
3. Add `--foreground` flag for daemon start (used by launcher)

**Step 1: Add daemon imports and ParsedArgs changes**

At the top of `index.ts`, add daemon imports:

```typescript
import { DaemonClient } from "./daemon/client.js";
import { runDaemonHost } from "./daemon/host.js";
import { getSocketPath, getMetadataPath } from "./daemon/paths.js";
```

Update `ParsedArgs` to include daemon mode:

```typescript
interface ParsedArgs {
  mode: "registry" | "server" | "manual" | "daemon";
  registryPath?: string;
  serverName?: string;
  transportType?: string;
  target?: string;
  serverArgs: string[];
  commandArgs: string[];
  daemonCommand?: "start" | "stop" | "status";
  daemonForeground?: boolean;
  daemonRegistryPath?: string;
  daemonSocketPath?: string;
  daemonMetadataPath?: string;
}
```

**Step 2: Update USAGE text**

Add daemon section to USAGE:

```
Daemon:
  mcp-utils daemon start           Start daemon for keep-alive servers
  mcp-utils daemon stop            Stop daemon
  mcp-utils daemon status          Show daemon status and connections
```

**Step 3: Add daemon command parsing**

In `parseCliArgs()`, before the existing `--server` check, add handling for when the first arg is `daemon`:

```typescript
// At start of while loop, handle "daemon" as first positional arg
if (arg === "daemon" && i === 0) {
  result.mode = "daemon";
  const sub = argv[++i];
  if (sub === "start" || sub === "stop" || sub === "status") {
    result.daemonCommand = sub;
  } else {
    console.error("Usage: mcp-utils daemon [start|stop|status]");
    process.exit(1);
  }
  i++;
  // Parse remaining flags for daemon start --foreground
  while (i < argv.length) {
    if (argv[i] === "--foreground") {
      result.daemonForeground = true;
    } else if (argv[i] === "--registry-path") {
      result.daemonRegistryPath = argv[++i];
    } else if (argv[i] === "--socket-path") {
      result.daemonSocketPath = argv[++i];
    } else if (argv[i] === "--metadata-path") {
      result.daemonMetadataPath = argv[++i];
    }
    i++;
  }
  break;
}
```

**Step 4: Update main() to handle daemon mode and keep-alive routing**

In `main()`, add daemon mode handling after registry mode:

```typescript
// --- Daemon mode ---
if (parsed.mode === "daemon") {
  const regPath = parsed.daemonRegistryPath
    ? resolve(parsed.daemonRegistryPath)
    : findRegistry(process.cwd());

  if (!regPath) {
    console.error("No mcp-registry.json found.");
    process.exit(1);
  }

  const client = new DaemonClient(regPath);

  switch (parsed.daemonCommand) {
    case "start": {
      if (parsed.daemonForeground) {
        // Called by launcher — run daemon host in this process
        const socketPath = parsed.daemonSocketPath ?? getSocketPath(regPath);
        const metadataPath = parsed.daemonMetadataPath ?? getMetadataPath(regPath);
        await runDaemonHost(regPath, socketPath, metadataPath);
      } else {
        // User-facing: ensure daemon is running
        const status = await client.status();
        if (status) {
          console.log("Daemon already running.");
          console.log(JSON.stringify(status, null, 2));
        } else {
          // Trigger auto-start by invoking status through invoke()
          await client.invoke("status", {});
          const newStatus = await client.status();
          console.log("Daemon started.");
          console.log(JSON.stringify(newStatus, null, 2));
        }
      }
      break;
    }
    case "stop":
      await client.stop();
      console.log("Daemon stopped.");
      break;
    case "status": {
      const status = await client.status();
      if (status) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("Daemon is not running.");
      }
      break;
    }
  }
  return;
}
```

In the server mode section, after resolving the registry entry, add keep-alive detection:

```typescript
// After: transportConfig = entry.transport;
// Add keep-alive routing:
if (entry.lifecycle === "keep-alive") {
  const daemonClient = new DaemonClient(regPath);
  const result = await runCommandViaDaemon(daemonClient, parsed.serverName!, parsed.commandArgs);
  return;
}
```

**Step 5: Add runCommandViaDaemon function**

Add this function to handle routing commands through the daemon:

```typescript
async function runCommandViaDaemon(
  daemon: DaemonClient,
  serverName: string,
  commandArgs: string[]
): Promise<void> {
  if (!commandArgs.length) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = commandArgs[0];
  let result: unknown;

  switch (command) {
    case "info":
      result = await daemon.invoke("serverInfo", { server: serverName });
      break;
    case "tools":
      result = await daemon.invoke("listTools", { server: serverName });
      break;
    case "call": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: call <tool-name> [json-args]"); process.exit(1); }
      const args = parseJsonArg(commandArgs[2]);
      const callResult = await daemon.invoke("callTool", { server: serverName, name, args }) as {
        isError?: boolean;
        content?: ContentItem[];
      };
      if (callResult?.isError) {
        const msg = callResult.content?.[0]?.text ?? "Unknown error";
        console.error(`Tool error: ${msg}`);
        process.exit(1);
      }
      if (callResult?.content) {
        printContent(callResult.content);
      }
      return;
    }
    case "resources":
      result = await daemon.invoke("listResources", { server: serverName });
      break;
    case "templates":
      result = await daemon.invoke("listResourceTemplates", { server: serverName });
      break;
    case "read": {
      const uri = commandArgs[1];
      if (!uri) { console.error("Usage: read <resource-uri>"); process.exit(1); }
      result = await daemon.invoke("readResource", { server: serverName, uri });
      break;
    }
    case "prompts":
      result = await daemon.invoke("listPrompts", { server: serverName });
      break;
    case "prompt": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: prompt <name> [json-args]"); process.exit(1); }
      const args = parseJsonArg(commandArgs[2]);
      result = await daemon.invoke("getPrompt", { server: serverName, name, args });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}
```

Note: extract `printContent` from `McpClient` class to a standalone function so `runCommandViaDaemon` can reuse it.

**Step 6: Extract printContent to standalone function**

Move the `printContent` method out of `McpClient` class into a standalone function at module level:

```typescript
function printContent(content: ContentItem[]): void {
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
```

Update `McpClient.printContent` to call the standalone function, or just remove the method and call `printContent` directly in `McpClient.callTool`.

**Step 7: Build and verify**

Run: `cd packages/mcp-utils && npm run build`
Expected: Build succeeds.

**Step 8: Test daemon commands**

Run: `cd packages/mcp-utils && ./dist/mcp-utils.cjs daemon status`
Expected: "Daemon is not running."

Run: `cd packages/mcp-utils && ./dist/mcp-utils.cjs --help`
Expected: Help text includes daemon section.

**Step 9: Commit**

```bash
git add packages/mcp-utils/src/index.ts
git commit -m "feat(mcp-utils): integrate daemon into CLI with keep-alive routing"
```

---

### Task 8: Update SKILL.md with daemon docs

**Files:**
- Modify: `skills/mcp-lazy-cli/SKILL.md`

**Step 1: Add daemon section to SKILL.md**

Add after the "决策规则" section:

```markdown
## Daemon (keep-alive servers)

Registry 中标记 `"lifecycle": "keep-alive"` 的 server 会通过后台 daemon 保持连接。

- 首次调用 keep-alive server 时 daemon 自动启动
- 后续调用复用同一连接，不重新握手
- 闲置超过 5 分钟的 server 自动断开

管理命令：

\`\`\`bash
npx mcp-utils daemon status    # 查看 daemon 状态
npx mcp-utils daemon start     # 手动启动
npx mcp-utils daemon stop      # 停止
\`\`\`
```

Add `lifecycle` field to the registry example in SKILL.md.

**Step 2: Commit**

```bash
git add skills/mcp-lazy-cli/SKILL.md
git commit -m "docs(mcp-lazy-cli): add daemon mode documentation"
```

---

### Task 9: End-to-end test with everything server

**Step 1: Create a test registry with keep-alive server**

Create a temporary `mcp-registry.json` with the everything server as keep-alive:

```json
{
  "servers": {
    "everything": {
      "description": "Test server",
      "lifecycle": "keep-alive",
      "transport": {
        "type": "stdio",
        "target": "npx",
        "args": ["--yes", "@modelcontextprotocol/server-everything", "stdio"]
      },
      "tools": [{ "name": "echo", "description": "Echo test" }]
    }
  }
}
```

**Step 2: Test daemon auto-start and tool call**

Run: `mcp-utils --server everything tools` (should auto-start daemon)
Run: `mcp-utils daemon status` (should show daemon running, everything connected)
Run: `mcp-utils --server everything call echo '{"message":"hello daemon"}'`
Expected: `Echo: hello daemon`
Run: `mcp-utils daemon stop`

**Step 3: Verify ephemeral still works**

Run: `mcp-utils --stdio "npx --yes @modelcontextprotocol/server-everything stdio" -- tools`
Expected: Works without daemon, same as before.

**Step 4: Clean up test files and commit**

```bash
git add -A
git commit -m "test(mcp-utils): verify daemon mode with everything server"
```
