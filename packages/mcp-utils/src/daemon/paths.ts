import { createHash } from "crypto";
import { join, resolve } from "path";
import { realpathSync } from "fs";
import { homedir } from "os";

function daemonDir(): string {
  return join(homedir(), ".mcp-utils", "daemon");
}

function normalizeRegistryPath(registryPath: string): string {
  try {
    return realpathSync(resolve(registryPath));
  } catch {
    return resolve(registryPath);
  }
}

function configKey(registryPath: string): string {
  return createHash("sha1").update(normalizeRegistryPath(registryPath)).digest("hex").slice(0, 12);
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
