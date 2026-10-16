// INPUT: Built fractal-context CLI and fixture projects
// OUTPUT: Node test assertions covering CLI Markdown, JSON, safety, and search behavior
// POS: End-to-end smoke tests for the Fractal Context CLI package

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = resolve(__dirname, "../dist/index.js");
const initializedRoot = resolve(__dirname, "fixtures/initialized");
const plainRoot = resolve(__dirname, "fixtures/plain");
const workspace = process.env.FRACTAL_TEST_WORKSPACE ?? resolve(__dirname, "../../../workspaces/fractal-docs/cli-tests");

function project(files) {
  mkdirSync(workspace, { recursive: true });
  const root = mkdtempSync(join(workspace, "run-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function json(args, root) {
  return JSON.parse(run([...args, "--root", root, "--json"]));
}

function run(args, options = {}) {
  return execFileSync("node", [bin, ...args], {
    cwd: initializedRoot,
    encoding: "utf8",
    ...options
  });
}

test("status reports legacy project facts without requiring source headers", () => {
  const output = run(["status", "--root", initializedRoot]);

  assert.match(output, /Fractal Context Status/);
  assert.match(output, /FRACTAL-DOCS\.md: yes/);
  assert.match(output, /Root AGENTS\.md: yes/);
  assert.doesNotMatch(output, /Missing header:/);
  assert.match(output, /Next:/);
});

test("status json distinguishes a plain project", () => {
  const output = run(["status", "--root", plainRoot, "--json"]);
  const data = JSON.parse(output);

  assert.equal(data.command, "status");
  assert.equal(data.root.endsWith("fixtures/plain"), true);
  assert.equal(data.hasProtocol, false);
  assert.equal(data.hasRootAgents, false);
  assert.deepEqual(data.staleSignals, []);
  assert.equal(data.documentCount, 1);
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
  assert.deepEqual(data.staleSignals, []);
  assert.equal(data.agents.path, "src/AGENTS.md");
  assert.deepEqual(data.document, data.agents);
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
  const large = `${"a".repeat(70 * 1024)}\nTRAILING_SENTINEL`;
  const root = project({ "src/large.ts": large });

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

test("directory navigation prefers module knowledge over README and Agent instructions", () => {
  const root = project({
    "src/MODULE.md": "# Parser\n\n> Distinguishes patch data from execution.\n\n## Why\nPatch text must not execute.\n",
    "src/README.md": "# Setup\n\nInstallation instructions.\n",
    "src/AGENTS.md": "# Instructions\n\nRun the project checks.\n",
    "src/parser.ts": "export const parser = true;\n"
  });
  const read = json(["read", "src"], root);
  assert.equal(read.document.path, "src/MODULE.md");
  assert.equal(read.agents, undefined);
  assert.equal(read.next[0], "fractal-context read src/MODULE.md");
  assert.equal(read.document.sections.some((section) => section.body.includes("Patch text must not execute")), true);
  const list = json(["list"], root);
  assert.match(list.entries.find((entry) => entry.path === "src").summary, /Distinguishes patch data/);
  assert.match(run(["read", "src", "--root", root]), /Patch text must not execute/);
  assert.equal(json(["list", "src"], root).next[0], "fractal-context read src/MODULE.md");
});

test("directory navigation reuses README without requiring a protocol or instruction file", () => {
  const root = project({
    "src/README.md": "# Cache\n\nCaches data for an accepted delay.\n",
    "src/cache.ts": "export const ttl = 60;\n"
  });
  const data = json(["list", "src"], root);
  assert.equal(data.document.path, "src/README.md");
  assert.match(data.document.summary, /Caches data/);
  assert.equal(data.agents, undefined);
  assert.deepEqual(json(["status"], root).staleSignals, []);
});

test("direct reads return ordinary Markdown text without a CLI-specific schema", () => {
  const content = "The queue owns retries across the API and worker modules.\n";
  const root = project({ "docs/queue-design.markdown": content, "MODULE.md": "# Queue\n" });
  for (const mode of ["auto", "docs", "full"]) {
    assert.equal(json(["read", "docs/queue-design.markdown", "--mode", mode], root).content, content);
  }
  assert.equal(json(["read", "MODULE.md"], root).content, "# Queue\n");
  assert.equal(json(["read", "docs/queue-design.markdown", "--mode", "headers"], root).content, undefined);
});

test("source reads point to module knowledge and docs mode selects the nearest module", () => {
  const root = project({
    "README.md": "# Project\n\nProject overview.\n",
    "src/MODULE.md": "# Parser\n\nPatch strings are data.\n",
    "src/nested/parser.ts": "export const marker = 'IMPLEMENTATION';\n"
  });
  const normal = json(["read", "src/nested/parser.ts"], root);
  assert.equal(normal.content, undefined);
  assert.equal(normal.document, undefined);
  assert.equal(normal.next[0], "fractal-context read src/MODULE.md");
  const docs = json(["read", "src/nested/parser.ts", "--mode", "docs"], root);
  assert.equal(docs.document.path, "src/MODULE.md");
  assert.match(docs.document.summary, /Patch strings are data/);
  assert.equal(docs.content, undefined);
  assert.match(json(["read", "src/nested/parser.ts", "--mode", "full"], root).content, /IMPLEMENTATION/);
});

test("search finds knowledge in module docs, README and arbitrary design files", () => {
  const root = project({
    "MODULE.md": "# Commands\n\nKeep the patch-boundary invariant.\n",
    "src/README.md": "# Parsing\n\nPreserve the patch-boundary invariant.\n",
    "docs/decisions.md": "A patch-boundary invariant spans two modules.\n\n# Details\n\nOther content.\n",
    ".gitignore": "private/\n",
    "private/hidden.md": "patch-boundary hidden material\n"
  });
  const data = json(["search", "patch-boundary"], root);
  const paths = new Set(data.results.filter((item) => item.type === "doc-section").map((item) => item.path));
  assert.deepEqual([...paths].sort(), ["MODULE.md", "docs/decisions.md", "src/README.md"].sort());
  assert.equal(data.results.some((item) => item.path.startsWith("private/")), false);
});

test("status checks explicit path tables and leaves ordinary Markdown links to normal project tools", () => {
  const root = project({
    "src/MODULE.md": [
      "# Parser", "", "See [test](../test/parser.test.mjs#boundary) and [history](https://example.com/fix).",
      "See [a space](<../test/a space.mjs>) and [this section](#why).", "",
      "| Tradeoff | Reason |", "|---|---|", "| latency | compatibility |", "",
      "| 名称 | 文件/子目录 | 职责 |", "|---|---|---|", "| Parser | `parser.ts` | Parse data |", "",
      "```markdown", "# Example", "[not a real link](missing-example.ts)",
      "| Path | Domain |", "|---|---|", "| absent.ts | Example |", "```", ""
    ].join("\n"),
    "src/parser.ts": "export const parser = true;\n",
    "test/parser.test.mjs": "// regression\n",
    "test/a space.mjs": "// regression\n"
  });
  const data = json(["status"], root);
  assert.deepEqual(data.staleSignals, []);
  const read = json(["read", "src"], root);
  assert.equal(read.document.businessRows[0].path, "parser.ts");
  assert.equal(read.document.sections.some((section) => section.title === "Example"), false);
});

test("status reports missing literal table paths relative to the document directory", () => {
  const root = project({ "src/MODULE.md": "# Parser\n\n| Path | Purpose |\n|---|---|\n| ../test/missing.test.mjs | Regression |\n" });
  const data = json(["status"], root);
  assert.deepEqual(data.staleSignals.map((signal) => signal.type), ["missing-mentioned-path"]);
  assert.equal(data.staleSignals[0].path, "src/MODULE.md");
  assert.match(data.staleSignals[0].detail, /\.\.\/test\/missing\.test\.mjs/);
});

test("source timestamps and missing optional headers do not declare knowledge stale", () => {
  const root = project({ "MODULE.md": "# Module\n", "source.ts": "export const n = 1;\n" });
  utimesSync(join(root, "MODULE.md"), new Date(0), new Date(0));
  assert.deepEqual(json(["status"], root).staleSignals, []);
});

test("Markdown and directory reads expose truncation instead of silently presenting complete knowledge", () => {
  const root = project({ "MODULE.md": `# Module\n\n${"a".repeat(70 * 1024)}\nTRAILING_SENTINEL` });
  const file = json(["read", "MODULE.md"], root);
  assert.equal(file.truncated, true);
  assert.equal(file.content.includes("TRAILING_SENTINEL"), false);
  const directory = json(["read", "."], root);
  assert.equal(directory.truncated, true);
  assert.equal(directory.document.truncated, true);
});

test("all four commands leave ordinary documentation and Agent instructions unchanged", () => {
  const files = { "MODULE.md": "# Knowledge\n\nPatch text is data.\n", "AGENTS.md": "# Work rules\n\nPreserve user rules.\n" };
  const root = project(files);
  for (const args of [["status"], ["list"], ["read", "MODULE.md"], ["search", "Patch"]]) json(args, root);
  for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(root, path), "utf8"), content);
});

test("suggested module reads remain usable when directory names contain spaces or quotes", () => {
  const root = project({ "a b's/MODULE.md": "# Parser\n", "a b's/source.ts": "export const n = 1;\n" });
  const data = json(["read", "a b's/source.ts"], root);
  assert.equal(data.next[0], "fractal-context read 'a b'\\''s/MODULE.md'");
});

test("status does not guess broken links from examples, escaped text, comments or parenthesized destinations", () => {
  const content = [
    "# Module", "", "[valid](./a(b).md)",
    "`[example](missing-example.ts)`", "\\[literal](missing-literal.ts)",
    "<!-- [comment](missing-comment.ts) -->", "[unchecked](genuinely-missing.ts)", ""
  ].join("\n");
  const root = project({ "MODULE.md": content, "a(b).md": "# Evidence\n" });
  assert.deepEqual(json(["status"], root).staleSignals, []);
  assert.equal(json(["read", "MODULE.md"], root).content, content);
});

test("data values matching header names cannot switch an explicit table's path column", () => {
  const root = project({
    "AGENTS.md": "# Legacy\n\n| Path | Domain |\n|---|---|\n| one.ts | File |\n| missing.ts | Parser |\n",
    "one.ts": "export const n = 1;\n"
  });
  const data = json(["read", "."], root);
  assert.deepEqual(data.document.businessRows.map((row) => row.path), ["one.ts", "missing.ts"]);
  assert.deepEqual(data.document, data.agents);
  assert.equal(data.staleSignals.length, 1);
  assert.match(data.staleSignals[0].detail, /missing\.ts$/);
});

test("path words in ordinary table data do not create an implicit path table", () => {
  const root = project({ "MODULE.md": "# Module\n\n| Decision | Reason |\n|---|---|\n| File | latency |\n| Cache | compatibility |\n" });
  const data = json(["read", "."], root);
  assert.deepEqual(data.document.businessRows, []);
  assert.deepEqual(data.staleSignals, []);
});

test("complex path-table cells remain in text without incorrect structured paths", () => {
  const content = [
    "# Module", "", "| Path | Domain |", "|---|---|",
    '| [source](existing.ts "Source module") | Code |', "| `existing.ts` | Literal |", "",
    "| Description | Path |", "|---|---|", "| alpha \\| beta | existing.ts |", ""
  ].join("\n");
  const root = project({ "MODULE.md": content, "existing.ts": "export const n = 1;\n" });
  const data = json(["read", "."], root);
  assert.deepEqual(data.document.businessRows.map((row) => row.path), ["existing.ts"]);
  assert.deepEqual(data.staleSignals, []);
  assert.equal(json(["read", "MODULE.md"], root).content, content);
});

test("headers scope cannot let matching Markdown bodies consume the result budget", () => {
  const root = project({
    "README.md": "# Module\n\nMATCH_SCOPE in prose.\n",
    "source.ts": "// INPUT: MATCH_SCOPE\nexport const n = 1;\n"
  });
  const data = json(["search", "MATCH_SCOPE", "--scope", "headers", "--max", "1"], root);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].type, "header");
  assert.equal(data.results[0].path, "source.ts");
});

test("an empty search result discloses when the searched Markdown text was truncated", () => {
  const root = project({ "MODULE.md": `# Module\n\n${"a".repeat(70 * 1024)}\nTAIL_SENTINEL` });
  const data = json(["search", "TAIL_SENTINEL"], root);
  assert.deepEqual(data.results, []);
  assert.equal(data.truncated, true);
});

test("all-scope search discloses truncated source text without increasing the scan range", () => {
  const root = project({ "source.ts": `${"a".repeat(20 * 1024)}\nTAIL_SENTINEL` });
  const data = json(["search", "TAIL_SENTINEL", "--scope", "all"], root);
  assert.deepEqual(data.results, []);
  assert.equal(data.truncated, true);
});
