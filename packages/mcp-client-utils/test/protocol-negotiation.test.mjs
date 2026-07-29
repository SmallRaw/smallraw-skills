import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../dist/mcp-utils.js", import.meta.url));
const serverPath = fileURLToPath(new URL("./fixtures/dual-era-server.mjs", import.meta.url));

async function listTools(protocol, serverArgs = []) {
  const protocolArgs = protocol ? ["--protocol", protocol] : [];
  return execFileAsync(process.execPath, [
    cliPath,
    ...protocolArgs,
    "--transport",
    "stdio",
    "--target",
    process.execPath,
    "--args",
    serverPath,
    ...serverArgs,
    "--",
    "tools",
  ], { timeout: 10_000 });
}

test("auto-negotiates MCP 2026-07-28 by default", async () => {
  const { stdout, stderr } = await listTools();
  assert.equal(stderr, "");
  assert.match(stdout, /"modern_tool"/);
});

test("auto-falls back to the legacy MCP era", async () => {
  const { stdout, stderr } = await listTools(undefined, ["--legacy-only"]);
  assert.equal(stderr, "");
  assert.match(stdout, /"legacy_tool"/);
});

test("can force the legacy MCP era", async () => {
  const { stdout, stderr } = await listTools("legacy");
  assert.equal(stderr, "");
  assert.match(stdout, /"legacy_tool"/);
});

test("can pin MCP 2026-07-28", async () => {
  const { stdout, stderr } = await listTools("2026-07-28");
  assert.equal(stderr, "");
  assert.match(stdout, /"modern_tool"/);
});
