import { existsSync } from "fs";
import { resolve } from "path";
import { McpClient } from "./core/client.js";
import { parseCliArgs } from "./cli/args.js";
import { USAGE } from "./cli/usage.js";
import { runCommand } from "./commands/direct.js";
import { runCommandViaDaemon } from "./commands/daemon.js";
import { findRegistry, loadRegistry } from "./core/registry.js";
import { createTransport } from "./core/transport.js";
import type { TransportConfig } from "./types.js";
import { DaemonClient } from "./daemon/client.js";
import { runDaemonHost } from "./daemon/host.js";
import { getSocketPath, getMetadataPath } from "./daemon/paths.js";

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

  // --- Daemon mode ---
  if (parsed.mode === "daemon") {
    const regPath = parsed.daemonRegistryPath
      ? resolve(parsed.daemonRegistryPath)
      : findRegistry(process.cwd());
    if (!regPath) { console.error("No mcp-registry.json found."); process.exit(1); }

    const client = new DaemonClient(regPath);
    switch (parsed.daemonCommand) {
      case "start": {
        if (parsed.daemonForeground) {
          const socketPath = parsed.daemonSocketPath ?? getSocketPath(regPath);
          const metadataPath = parsed.daemonMetadataPath ?? getMetadataPath(regPath);
          await runDaemonHost(regPath, socketPath, metadataPath);
        } else {
          const status = await client.status();
          if (status) {
            console.log("Daemon already running.");
            console.log(JSON.stringify(status, null, 2));
          } else {
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
        if (status) { console.log(JSON.stringify(status, null, 2)); }
        else { console.log("Daemon is not running."); }
        break;
      }
    }
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

    // Route keep-alive servers through daemon
    if (entry.lifecycle === "keep-alive") {
      const daemonClient = new DaemonClient(regPath);
      await runCommandViaDaemon(daemonClient, parsed.serverName!, parsed.commandArgs);
      return;
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
