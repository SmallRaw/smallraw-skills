// INPUT: Raw process argv values for fractal-context commands
// OUTPUT: Parsed command options with validation errors for invalid usage
// POS: CLI argument parser for the Fractal Context executable

import type { CommandName, ReadMode, SearchScope } from "./core.js";

export interface ParsedArgs {
  command: CommandName;
  path?: string;
  query?: string;
  root?: string;
  json: boolean;
  depth?: number;
  max?: number;
  mode?: ReadMode;
  scope?: SearchScope;
}

const USAGE = `Usage:
  fractal-context status [--root <path>] [--json]
  fractal-context list [path] [--depth <1-3>] [--max <n>] [--root <path>] [--json]
  fractal-context read <path> [--mode auto|docs|headers|full] [--root <path>] [--json]
  fractal-context search <query> [--scope docs|headers|all] [--max <n>] [--root <path>] [--json]`;

export function usage(): string {
  return USAGE;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const command = args.shift() as CommandName | undefined;
  if (!command || !["status", "list", "read", "search"].includes(command)) {
    throw new Error(USAGE);
  }

  const parsed: ParsedArgs = { command, json: false };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--root":
        parsed.root = requireValue(args, ++i, "--root");
        break;
      case "--depth":
        parsed.depth = parsePositiveInt(requireValue(args, ++i, "--depth"), "--depth");
        break;
      case "--max":
        parsed.max = parsePositiveInt(requireValue(args, ++i, "--max"), "--max");
        break;
      case "--mode": {
        const mode = requireValue(args, ++i, "--mode") as ReadMode;
        if (!["auto", "docs", "headers", "full"].includes(mode)) throw new Error(`Invalid --mode: ${mode}`);
        parsed.mode = mode;
        break;
      }
      case "--scope": {
        const scope = requireValue(args, ++i, "--scope") as SearchScope;
        if (!["docs", "headers", "all"].includes(scope)) throw new Error(`Invalid --scope: ${scope}`);
        parsed.scope = scope;
        break;
      }
      case "--help":
      case "-h":
        throw new Error(USAGE);
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}\n${USAGE}`);
        positionals.push(arg);
    }
  }

  if (command === "list") parsed.path = positionals[0] ?? ".";
  if (command === "read") {
    if (!positionals[0]) throw new Error(`Missing path for read\n${USAGE}`);
    parsed.path = positionals[0];
  }
  if (command === "search") {
    if (!positionals[0]) throw new Error(`Missing query for search\n${USAGE}`);
    parsed.query = positionals.join(" ");
  }
  if (command === "status" && positionals.length > 0) {
    throw new Error(`status does not accept positional arguments\n${USAGE}`);
  }

  return parsed;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parsePositiveInt(value: string, option: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`);
  return parsed;
}
