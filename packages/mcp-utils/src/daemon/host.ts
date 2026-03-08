import * as net from "net";
import * as fs from "fs";
import { dirname } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  ServerStatus,
} from "./protocol.js";
import type { ServerEntry, Registry } from "../types.js";
import { createTransport } from "../core/transport.js";
import { loadRegistry } from "../core/registry.js";

// --- Constants ---

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

// --- Managed MCP Server ---

interface ManagedServer {
  name: string;
  entry: ServerEntry;
  client: Client | null;
  connected: boolean;
  lastUsedAt: number;
  connecting: Promise<void> | null;
}

// --- Host ---

export async function runDaemonHost(
  registryPath: string,
  socketPath: string,
  metadataPath: string,
): Promise<void> {
  // 1. Load registry, find keep-alive servers
  const registry = loadRegistry(registryPath);
  const keepAliveServers = getKeepAliveServers(registry);

  // Connection pool
  const pool = new Map<string, ManagedServer>();
  for (const [name, entry] of Object.entries(keepAliveServers)) {
    pool.set(name, {
      name,
      entry,
      client: null,
      connected: false,
      lastUsedAt: Date.now(),
      connecting: null,
    });
  }

  // 2. Ensure socket directory exists & clean stale socket
  const socketDir = dirname(socketPath);
  fs.mkdirSync(socketDir, { recursive: true });
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  // 3. Create Unix socket server
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = "";
    let handled = false;

    const tryHandle = (): void => {
      if (handled) return;
      const trimmed = data.trim();
      if (!trimmed) return;
      let req: DaemonRequest;
      try {
        req = JSON.parse(trimmed) as DaemonRequest;
      } catch {
        return; // not complete JSON yet
      }
      handled = true;
      handleConnection(trimmed, socket, pool, socketPath, registryPath, server)
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          try {
            const errorResp: DaemonResponse = {
              id: "unknown",
              ok: false,
              error: { message: errMsg },
            };
            socket.write(JSON.stringify(errorResp), () => socket.end());
          } catch {
            socket.destroy();
          }
        });
    };

    socket.on("data", (chunk) => {
      data += chunk.toString();
      tryHandle();
    });

    socket.on("end", () => {
      if (!handled) tryHandle();
    });

    socket.on("error", () => {
      socket.destroy();
    });
  });

  server.listen(socketPath, () => {
    // 6. Write metadata file on startup
    writeMetadata(metadataPath, socketPath);
  });

  // 5. Idle eviction timer
  const idleTimer = setInterval(() => {
    evictIdleServers(pool);
  }, IDLE_CHECK_INTERVAL_MS);
  idleTimer.unref();

  // 7. Clean up on exit
  const cleanup = async () => {
    clearInterval(idleTimer);

    // Close all MCP clients
    for (const managed of pool.values()) {
      if (managed.client && managed.connected) {
        try {
          await managed.client.close();
        } catch {
          // ignore close errors
        }
      }
    }

    // Remove socket file
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    } catch {
      // ignore
    }

    // Remove metadata file
    try {
      if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
    } catch {
      // ignore
    }

    server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => { cleanup(); });
  process.on("SIGTERM", () => { cleanup(); });

  // Block forever — the server keeps the event loop alive
  await new Promise<void>(() => {
    // never resolves
  });
}

// --- Request Handler ---

async function handleConnection(
  data: string,
  socket: net.Socket,
  pool: Map<string, ManagedServer>,
  socketPath: string,
  registryPath: string,
  server: net.Server,
): Promise<void> {
  let request: DaemonRequest;
  try {
    request = JSON.parse(data) as DaemonRequest;
  } catch {
    const resp: DaemonResponse = {
      id: "unknown",
      ok: false,
      error: { message: "Invalid JSON" },
    };
    socket.end(JSON.stringify(resp) + "\n");
    return;
  }

  const response = await routeRequest(request, pool, socketPath, registryPath, server);
  socket.write(JSON.stringify(response), () => socket.end());

  // If stop was requested, shut down after responding
  if (request.method === "stop") {
    setTimeout(() => {
      process.emit("SIGTERM", "SIGTERM");
    }, 100);
  }
}

async function routeRequest(
  req: DaemonRequest,
  pool: Map<string, ManagedServer>,
  socketPath: string,
  registryPath: string,
  server: net.Server,
): Promise<DaemonResponse> {
  try {
    switch (req.method) {
      case "status":
        return {
          id: req.id,
          ok: true,
          result: buildStatus(pool, socketPath),
        };

      case "stop":
        return {
          id: req.id,
          ok: true,
          result: { message: "Daemon stopping" },
        };

      case "serverInfo": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const info = managed.client!.getServerVersion();
        const caps = managed.client!.getServerCapabilities();
        return {
          id: req.id,
          ok: true,
          result: { server: info, capabilities: caps },
        };
      }

      case "listTools": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.listTools();
        return { id: req.id, ok: true, result: result.tools };
      }

      case "callTool": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const params: { name: string; arguments?: Record<string, unknown> } = {
          name: req.params.name!,
        };
        if (req.params.args && Object.keys(req.params.args).length > 0) {
          params.arguments = req.params.args;
        }
        const result = await managed.client!.callTool(params);
        return { id: req.id, ok: true, result };
      }

      case "listResources": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.listResources();
        return { id: req.id, ok: true, result: result.resources };
      }

      case "listResourceTemplates": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.listResourceTemplates();
        return { id: req.id, ok: true, result: result.resourceTemplates };
      }

      case "readResource": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.readResource({
          uri: req.params.uri!,
        });
        return { id: req.id, ok: true, result: result.contents };
      }

      case "listPrompts": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.listPrompts();
        return { id: req.id, ok: true, result: result.prompts };
      }

      case "getPrompt": {
        const managed = getServer(pool, req.params.server);
        await ensureConnected(managed);
        const result = await managed.client!.getPrompt({
          name: req.params.name!,
          arguments: (req.params.args as Record<string, string>) ?? {},
        });
        return { id: req.id, ok: true, result };
      }

      default:
        return {
          id: req.id,
          ok: false,
          error: { message: `Unknown method: ${req.method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: req.id, ok: false, error: { message } };
  }
}

// --- Helpers ---

function getKeepAliveServers(registry: Registry): Record<string, ServerEntry> {
  const result: Record<string, ServerEntry> = {};
  for (const [name, entry] of Object.entries(registry.servers)) {
    if (entry.lifecycle === "keep-alive") {
      result[name] = entry;
    }
  }
  return result;
}

function getServer(
  pool: Map<string, ManagedServer>,
  serverName: string | undefined,
): ManagedServer {
  if (!serverName) {
    throw new Error("Missing 'server' parameter");
  }
  const managed = pool.get(serverName);
  if (!managed) {
    const available = Array.from(pool.keys()).join(", ");
    throw new Error(
      `Server "${serverName}" not found in daemon pool. Available: ${available || "(none)"}`,
    );
  }
  return managed;
}

async function ensureConnected(managed: ManagedServer): Promise<void> {
  managed.lastUsedAt = Date.now();

  if (managed.connected && managed.client) {
    return;
  }

  // If already connecting, wait for that
  if (managed.connecting) {
    await managed.connecting;
    return;
  }

  managed.connecting = (async () => {
    try {
      const client = new Client({
        name: "mcp-daemon",
        version: "1.0.0",
      });
      const transport = createTransport(managed.entry.transport);
      await client.connect(transport);
      managed.client = client;
      managed.connected = true;
    } finally {
      managed.connecting = null;
    }
  })();

  await managed.connecting;
}

function evictIdleServers(pool: Map<string, ManagedServer>): void {
  const now = Date.now();
  for (const managed of pool.values()) {
    if (
      managed.connected &&
      managed.client &&
      now - managed.lastUsedAt > IDLE_TIMEOUT_MS
    ) {
      managed.client.close().catch(() => {});
      managed.client = null;
      managed.connected = false;
    }
  }
}

function buildStatus(
  pool: Map<string, ManagedServer>,
  socketPath: string,
): DaemonStatus {
  const servers: ServerStatus[] = [];
  for (const managed of pool.values()) {
    servers.push({
      name: managed.name,
      connected: managed.connected,
      lastUsedAt: managed.lastUsedAt,
    });
  }
  return {
    pid: process.pid,
    startedAt: startedAt,
    socketPath,
    servers,
  };
}

const startedAt = Date.now();

function writeMetadata(metadataPath: string, socketPath: string): void {
  const dir = dirname(metadataPath);
  fs.mkdirSync(dir, { recursive: true });
  const metadata = {
    pid: process.pid,
    startedAt,
    socketPath,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
}
