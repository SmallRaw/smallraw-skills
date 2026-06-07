// INPUT: Built fractal-context CLI and fixture projects
// OUTPUT: Node test assertions covering CLI Markdown, JSON, safety, and search behavior
// POS: End-to-end smoke tests for the Fractal Context CLI package

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = resolve(__dirname, "../dist/index.js");
const initializedRoot = resolve(__dirname, "fixtures/initialized");
const plainRoot = resolve(__dirname, "fixtures/plain");

function run(args, options = {}) {
  return execFileSync("node", [bin, ...args], {
    cwd: initializedRoot,
    encoding: "utf8",
    ...options
  });
}

test("status reports initialized project facts and stale signals", () => {
  const output = run(["status", "--root", initializedRoot]);

  assert.match(output, /Fractal Context Status/);
  assert.match(output, /FRACTAL-DOCS\.md: yes/);
  assert.match(output, /Root AGENTS\.md: yes/);
  assert.match(output, /Missing header: src\/lib\/no-header\.ts/);
  assert.match(output, /Next:/);
});

test("status json distinguishes a plain project", () => {
  const output = run(["status", "--root", plainRoot, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.command, "status");
  assert.equal(data.root.endsWith("fixtures/plain"), true);
  assert.equal(data.hasProtocol, false);
  assert.equal(data.hasRootAgents, false);
});

test("list shows AGENTS summary, file headers, and next commands", () => {
  const output = run(["list", "src", "--depth", "2", "--root", initializedRoot]);

  assert.match(output, /Fractal List: src/);
  assert.match(output, /Source tree for API and library code/);
  assert.match(output, /src\/api\/server\.ts/);
  assert.match(output, /POS: API entrypoint for wallet routes/);
  assert.match(output, /Next:/);
});

test("list json exposes structured entries and stale metadata", () => {
  const output = run(["list", "src", "--depth", "2", "--root", initializedRoot, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.command, "list");
  assert.equal(data.path, "src");
  assert.equal(data.entries.some((entry) => entry.path === "src/api/server.ts" && entry.header?.pos), true);
  assert.equal(data.staleSignals.some((signal) => signal.type === "missing-header"), true);
});

test("read directory returns parsed AGENTS sections", () => {
  const output = run(["read", "src", "--root", initializedRoot]);

  assert.match(output, /Fractal Read: src/);
  assert.match(output, /Source Agents/);
  assert.match(output, /Business Domains/);
  assert.match(output, /directory: src\/api/);
});

test("read returns file header view by default", () => {
  const output = run(["read", "src/lib/wallet.ts", "--root", initializedRoot]);

  assert.match(output, /Fractal Read: src\/lib\/wallet\.ts/);
  assert.match(output, /INPUT: Account balance records/);
  assert.doesNotMatch(output, /export function spendableBalance/);
});

test("read json exposes header object", () => {
  const output = run(["read", "src/lib/wallet.ts", "--root", initializedRoot, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.command, "read");
  assert.equal(data.kind, "file");
  assert.equal(data.header.input, "Account balance records");
  assert.equal(data.content, undefined);
});

test("read full returns capped file content", () => {
  const output = run(["read", "src/lib/wallet.ts", "--mode", "full", "--root", initializedRoot]);

  assert.match(output, /export function spendableBalance/);
});

test("read full reports truncation for oversized files", () => {
  const root = mkdtempSync(join(tmpdir(), "fractal-context-"));
  writeFileSync(join(root, "FRACTAL-DOCS.md"), "# Protocol\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agents\n\n## Summary\n\nTemp fixture.\n");
  mkdirSync(join(root, "src"));
  const large = `${"a".repeat(70 * 1024)}\nTRAILING_SENTINEL`;
  writeFileSync(join(root, "src/large.ts"), large);

  const output = run(["read", "src/large.ts", "--mode", "full", "--root", root, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.truncated, true);
  assert.equal(data.content.includes("TRAILING_SENTINEL"), false);
});

test("search prioritizes docs and headers before filenames", () => {
  const output = run(["search", "wallet", "--root", initializedRoot]);

  assert.match(output, /Fractal Search: wallet/);
  assert.match(output, /agents-section/);
  assert.match(output, /header/);
});

test("search all falls back to source content", () => {
  const output = run(["search", "spendableBalance", "--scope", "all", "--root", initializedRoot, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.results.some((item) => item.type === "source" && item.path === "src/lib/wallet.ts"), true);
});

test("rejects path traversal", () => {
  assert.throws(
    () => run(["read", "../README.md", "--root", initializedRoot], { stdio: "pipe" }),
    /Path escapes project root/
  );
});

test("invalid command exits non-zero with usage", () => {
  assert.throws(
    () => run(["unknown"], { stdio: "pipe" }),
    /Usage:/
  );
});

test("help exits zero with usage", () => {
  const output = run(["--help"]);

  assert.match(output, /fractal-context status/);
  assert.match(output, /fractal-context search/);
});
