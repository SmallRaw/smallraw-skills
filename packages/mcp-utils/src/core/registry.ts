import { readFileSync, existsSync, realpathSync } from "fs";
import { resolve, dirname } from "path";
import type { Registry } from "../types.js";

export function findRegistry(startDir: string): string | null {
  let dir = resolve(startDir);
  try { dir = realpathSync(dir); } catch {}
  for (let i = 0; i < 20; i++) {
    const root = resolve(dir, "mcp-registry.json");
    if (existsSync(root)) return realpathSync(root);
    const dotClaude = resolve(dir, ".claude", "mcp-registry.json");
    if (existsSync(dotClaude)) return realpathSync(dotClaude);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadRegistry(registryPath: string): Registry {
  const raw = readFileSync(registryPath, "utf-8");
  return JSON.parse(raw) as Registry;
}
