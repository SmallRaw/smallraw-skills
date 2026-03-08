import { USAGE } from "./usage.js";

export interface ParsedArgs {
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

export function parseCliArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const result: ParsedArgs = { mode: "manual", serverArgs: [], commandArgs: [] };

  if (!argv.length) {
    console.log(USAGE);
    process.exit(0);
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "daemon" && result.commandArgs.length === 0 && !result.serverName) {
      result.mode = "daemon";
      const sub = argv[++i];
      if (sub === "start" || sub === "stop" || sub === "status") {
        result.daemonCommand = sub;
      } else {
        console.error("Usage: mcp-client-utils daemon [start|stop|status]");
        process.exit(1);
      }
      i++;
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

    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--registry") {
      result.mode = "registry";
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        result.registryPath = argv[++i];
      }
      i++;
    } else if (arg === "--server" || arg === "-s") {
      result.mode = "server";
      result.serverName = argv[++i];
      i++;
      result.commandArgs = argv.slice(i);
      break;
    } else if (arg === "--stdio") {
      result.mode = "manual";
      result.transportType = "stdio";
      const value = argv[++i];
      const parts = value.split(/\s+/);
      result.target = parts[0];
      result.serverArgs = parts.slice(1);
      i++;
    } else if (arg === "--http") {
      result.mode = "manual";
      result.transportType = "http";
      result.target = argv[++i];
      i++;
    } else if (arg === "--sse") {
      result.mode = "manual";
      result.transportType = "sse";
      result.target = argv[++i];
      i++;
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
      result.commandArgs = argv.slice(i);
      break;
    }
  }

  return result;
}

export function parseJsonArg(arg: string | undefined): Record<string, unknown> | undefined {
  if (!arg) return undefined;
  try {
    return JSON.parse(arg);
  } catch {
    console.error(`Invalid JSON argument: ${arg}`);
    process.exit(1);
  }
}
