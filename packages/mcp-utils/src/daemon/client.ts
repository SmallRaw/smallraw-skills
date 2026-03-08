import net from "net";
import { randomUUID } from "crypto";
import { getSocketPath, getMetadataPath } from "./paths.js";
import { launchDaemonDetached } from "./launch.js";
import type {
  DaemonMethod,
  DaemonRequest,
  DaemonResponse,
} from "./protocol.js";

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

  async invoke(
    method: DaemonMethod,
    params: Record<string, unknown>,
  ): Promise<unknown> {
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

  private sendRequest(
    method: DaemonMethod,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const request: DaemonRequest = { id: randomUUID(), method, params };
    const payload = JSON.stringify(request);

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      let buffer = "";

      socket.setTimeout(DAEMON_TIMEOUT_MS, () => {
        socket.destroy(
          Object.assign(new Error("Daemon request timed out"), {
            code: "ETIMEDOUT",
          }),
        );
      });

      socket.on("connect", () => {
        socket.write(payload, (err) => {
          if (err && !settled) {
            settled = true;
            reject(err);
          }
        });
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
      });

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
            return reject(
              new Error(parsed.error?.message ?? "Daemon error"),
            );
          }
          resolve(parsed.result);
        } catch {
          const err = new Error("Failed to parse daemon response");
          (err as NodeJS.ErrnoException).code = "ECONNRESET";
          reject(err);
        }
      });

      socket.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }
}

function isTransportError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as NodeJS.ErrnoException).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOENT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
