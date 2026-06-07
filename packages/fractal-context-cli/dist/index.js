#!/usr/bin/env node
"use strict";

// src/args.ts
var USAGE = `Usage:
  fractal-context status [--root <path>] [--json]
  fractal-context list [path] [--depth <1-3>] [--max <n>] [--root <path>] [--json]
  fractal-context read <path> [--mode auto|docs|headers|full] [--root <path>] [--json]
  fractal-context search <query> [--scope docs|headers|all] [--max <n>] [--root <path>] [--json]`;
function usage() {
  return USAGE;
}
function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || !["status", "list", "read", "search"].includes(command)) {
    throw new Error(USAGE);
  }
  const parsed = { command, json: false };
  const positionals = [];
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
        const mode = requireValue(args, ++i, "--mode");
        if (!["auto", "docs", "headers", "full"].includes(mode)) throw new Error(`Invalid --mode: ${mode}`);
        parsed.mode = mode;
        break;
      }
      case "--scope": {
        const scope = requireValue(args, ++i, "--scope");
        if (!["docs", "headers", "all"].includes(scope)) throw new Error(`Invalid --scope: ${scope}`);
        parsed.scope = scope;
        break;
      }
      case "--help":
      case "-h":
        throw new Error(USAGE);
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}
${USAGE}`);
        positionals.push(arg);
    }
  }
  if (command === "list") parsed.path = positionals[0] ?? ".";
  if (command === "read") {
    if (!positionals[0]) throw new Error(`Missing path for read
${USAGE}`);
    parsed.path = positionals[0];
  }
  if (command === "search") {
    if (!positionals[0]) throw new Error(`Missing query for search
${USAGE}`);
    parsed.query = positionals.join(" ");
  }
  if (command === "status" && positionals.length > 0) {
    throw new Error(`status does not accept positional arguments
${USAGE}`);
  }
  return parsed;
}
function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}
function parsePositiveInt(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

// src/core.ts
var import_fs = require("fs");
var import_path = require("path");
var DEFAULT_MAX_ENTRIES = 80;
var MAX_DEPTH = 3;
var FULL_READ_BYTES = 64 * 1024;
var HEADER_SCAN_BYTES = 16 * 1024;
var STATUS_SCAN_LIMIT = 2e3;
var SEARCH_SCAN_LIMIT = 3e3;
var IGNORED_NAMES = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".claude",
  ".codex",
  ".idea",
  ".vscode"
]);
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".lua",
  ".dart",
  ".vue",
  ".svelte"
]);
function resolveRoot(root) {
  return (0, import_path.resolve)(root ?? process.cwd());
}
function safeResolve(root, requested = ".") {
  const candidate = (0, import_path.isAbsolute)(requested) ? (0, import_path.resolve)(requested) : (0, import_path.resolve)(root, requested);
  const rel = (0, import_path.relative)(root, candidate);
  if (rel === "" || !rel.startsWith("..") && !(0, import_path.isAbsolute)(rel)) {
    return candidate;
  }
  throw new Error(`Path escapes project root: ${requested}`);
}
function toRel(root, absolutePath) {
  const rel = (0, import_path.relative)(root, absolutePath);
  return rel === "" ? "." : rel.split(import_path.sep).join("/");
}
function loadIgnoreRules(root) {
  const rules = { names: new Set(IGNORED_NAMES), relPaths: /* @__PURE__ */ new Set() };
  const gitignore = (0, import_path.join)(root, ".gitignore");
  if (!(0, import_fs.existsSync)(gitignore)) return rules;
  const { text } = readText(gitignore, 64 * 1024);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    if (line.includes("*")) continue;
    const normalized = line.replace(/^\//, "").replace(/\/$/, "");
    if (!normalized) continue;
    if (!normalized.includes("/")) {
      rules.names.add(normalized);
    } else {
      rules.relPaths.add(normalized);
    }
  }
  return rules;
}
function isIgnored(absPath, root, rules) {
  const activeRules = rules ?? { names: IGNORED_NAMES, relPaths: /* @__PURE__ */ new Set() };
  if (absPath.split(import_path.sep).some((part) => activeRules.names.has(part))) return true;
  if (!root) return false;
  const rel = toRel(root, absPath);
  for (const ignoredRel of activeRules.relPaths) {
    if (rel === ignoredRel || rel.startsWith(`${ignoredRel}/`)) return true;
  }
  return false;
}
function isLikelyBinary(absPath) {
  try {
    const buf = (0, import_fs.readFileSync)(absPath, { encoding: null });
    const sample = buf.subarray(0, Math.min(buf.length, 8e3));
    return sample.includes(0);
  } catch {
    return true;
  }
}
function extensionOf(path) {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}
function isSourceLike(absPath) {
  return SOURCE_EXTENSIONS.has(extensionOf(absPath));
}
function readText(absPath, maxBytes = FULL_READ_BYTES) {
  const buf = (0, import_fs.readFileSync)(absPath, { encoding: null });
  const truncated = buf.length > maxBytes;
  const chunk = truncated ? buf.subarray(0, maxBytes) : buf;
  return { text: chunk.toString("utf8"), truncated };
}
function listDir(absPath) {
  return (0, import_fs.readdirSync)(absPath).filter((name) => !IGNORED_NAMES.has(name)).sort((a, b) => a.localeCompare(b));
}
function parseHeader(absPath) {
  if (!(0, import_fs.existsSync)(absPath) || (0, import_fs.statSync)(absPath).isDirectory() || isLikelyBinary(absPath)) return void 0;
  const { text } = readText(absPath, HEADER_SCAN_BYTES);
  const lines = text.split(/\r?\n/).slice(0, 80);
  const found = { lines: [] };
  for (const line of lines) {
    const cleaned = line.replace(/^\s*(\/\/|#|--|;|\*|\/\*+|\*\/)\s?/, "").replace(/^\s*<!--\s?/, "").replace(/\s?-->\s*$/, "").trim();
    const match = cleaned.match(/^(INPUT|OUTPUT|POS)\s*:\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    found[key] = match[2].trim();
    found.lines.push(`${match[1].toUpperCase()}: ${match[2].trim()}`);
  }
  return found.input || found.output || found.pos ? found : void 0;
}
function parseAgents(root, agentsPath) {
  if (!(0, import_fs.existsSync)(agentsPath)) return void 0;
  const { text } = readText(agentsPath, FULL_READ_BYTES);
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current;
  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push({ title: current.title, body: current.bodyLines.join("\n").trim() });
      current = { title: match[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.bodyLines.join("\n").trim() });
  const summary = sections.find((s) => /summary|overview|职责|概览|说明/i.test(s.title))?.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" ");
  const businessRows = [];
  const mentionedPaths = /* @__PURE__ */ new Set();
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2 || cells.every((cell) => /^-+$/.test(cell.replace(/:/g, "")))) continue;
    if (/^path$/i.test(cells[0]) || /^路径$/.test(cells[0])) continue;
    const pathCell = cells[0];
    if (!pathCell || pathCell.includes(" ")) continue;
    businessRows.push({
      path: pathCell,
      domain: cells[1] ?? "",
      notes: cells.slice(2).join(" | "),
      raw: line.trim()
    });
    mentionedPaths.add(pathCell);
  }
  return {
    path: toRel(root, agentsPath),
    summary,
    sections,
    businessRows,
    mentionedPaths: [...mentionedPaths]
  };
}
function walk(root, start, options = {}) {
  const maxFiles = options.maxFiles ?? STATUS_SCAN_LIMIT;
  const result = [];
  const stack = [start];
  const rules = loadIgnoreRules(root);
  while (stack.length > 0 && result.length < maxFiles) {
    const current = stack.pop();
    if (isIgnored(current, root, rules) || !(0, import_fs.existsSync)(current)) continue;
    const st = (0, import_fs.lstatSync)(current);
    if (st.isDirectory()) {
      if (options.includeDirs) result.push(current);
      const children = listDir(current).map((name) => (0, import_path.join)(current, name)).reverse();
      stack.push(...children);
    } else {
      result.push(current);
    }
  }
  return result.filter((p) => p === root || !isIgnored(p, root, rules));
}
function nearestAgents(path, root) {
  let current = (0, import_fs.statSync)(path).isDirectory() ? path : (0, import_path.dirname)(path);
  while (true) {
    const candidate = (0, import_path.join)(current, "AGENTS.md");
    if ((0, import_fs.existsSync)(candidate)) return candidate;
    if (current === root) return void 0;
    const next = (0, import_path.dirname)(current);
    if (next === current) return void 0;
    current = next;
  }
}
function collectStaleSignals(root, files) {
  const signals = [];
  if (!(0, import_fs.existsSync)((0, import_path.join)(root, "FRACTAL-DOCS.md"))) {
    signals.push({ type: "missing-protocol", path: ".", detail: "FRACTAL-DOCS.md not found" });
  }
  if (!(0, import_fs.existsSync)((0, import_path.join)(root, "AGENTS.md"))) {
    signals.push({ type: "missing-root-agents", path: ".", detail: "Root AGENTS.md not found" });
  }
  const agentsFiles = files.filter((file) => (0, import_path.basename)(file) === "AGENTS.md");
  for (const agentsPath of agentsFiles) {
    const parsed = parseAgents(root, agentsPath);
    if (!parsed) continue;
    const base = (0, import_path.dirname)(agentsPath);
    for (const mentioned of parsed.mentionedPaths) {
      if (mentioned.startsWith("http") || mentioned.startsWith("#")) continue;
      const target = safeResolve(base, mentioned);
      if (!(0, import_fs.existsSync)(target)) {
        signals.push({
          type: "missing-mentioned-path",
          path: toRel(root, agentsPath),
          detail: `AGENTS.md mentions missing path: ${mentioned}`
        });
      }
    }
  }
  for (const file of files) {
    if ((0, import_path.basename)(file) === "AGENTS.md" || (0, import_path.basename)(file) === "FRACTAL-DOCS.md") continue;
    if (!isSourceLike(file) || isLikelyBinary(file)) continue;
    const header = parseHeader(file);
    if (!header) {
      signals.push({
        type: "missing-header",
        path: toRel(root, file),
        detail: `Missing header: ${toRel(root, file)}`
      });
    }
    const agents = nearestAgents(file, root);
    if (agents && (0, import_fs.statSync)(file).mtimeMs > (0, import_fs.statSync)(agents).mtimeMs + 1e3) {
      signals.push({
        type: "source-newer-than-agents",
        path: toRel(root, file),
        detail: `${toRel(root, file)} is newer than ${toRel(root, agents)}`
      });
    }
  }
  return signals.slice(0, 50);
}
function getStatus(options = {}) {
  const root = resolveRoot(options.root);
  const files = walk(root, root, { maxFiles: STATUS_SCAN_LIMIT });
  const agentsCount = files.filter((file) => (0, import_path.basename)(file) === "AGENTS.md").length;
  const headerCount = files.filter((file) => parseHeader(file)).length;
  const staleSignals = collectStaleSignals(root, files);
  return {
    command: "status",
    root,
    hasProtocol: (0, import_fs.existsSync)((0, import_path.join)(root, "FRACTAL-DOCS.md")),
    hasRootAgents: (0, import_fs.existsSync)((0, import_path.join)(root, "AGENTS.md")),
    agentsCount,
    headerCount,
    scannedFiles: files.length,
    staleSignals,
    next: (0, import_fs.existsSync)((0, import_path.join)(root, "AGENTS.md")) ? ["fractal-context list", "fractal-context read AGENTS.md"] : ["Use /fractal-docs init to create protocol docs"]
  };
}
function listContext(path = ".", options = {}) {
  const root = resolveRoot(options.root);
  const target = safeResolve(root, path);
  if (!(0, import_fs.existsSync)(target) || !(0, import_fs.statSync)(target).isDirectory()) {
    throw new Error(`List path is not a directory: ${path}`);
  }
  const requestedDepth = Math.min(Math.max(options.depth ?? 1, 1), MAX_DEPTH);
  const max = options.max ?? DEFAULT_MAX_ENTRIES;
  const entries = [];
  const ignoreRules = loadIgnoreRules(root);
  function visit(dir, depth) {
    if (entries.length >= max) return;
    for (const name of listDir(dir)) {
      if (entries.length >= max) return;
      const child = (0, import_path.join)(dir, name);
      if (isIgnored(child, root, ignoreRules)) continue;
      const st = (0, import_fs.lstatSync)(child);
      if (st.isDirectory()) {
        const agents = parseAgents(root, (0, import_path.join)(child, "AGENTS.md"));
        entries.push({ path: toRel(root, child), kind: "directory", summary: agents?.summary });
        if (depth < requestedDepth) visit(child, depth + 1);
      } else {
        entries.push({ path: toRel(root, child), kind: "file", header: parseHeader(child) });
      }
    }
  }
  visit(target, 1);
  const subtreeFiles = walk(root, target, { maxFiles: max * 10 });
  return {
    command: "list",
    root,
    path: toRel(root, target),
    agents: parseAgents(root, (0, import_path.join)(target, "AGENTS.md")),
    entries,
    truncated: entries.length >= max,
    staleSignals: collectStaleSignals(root, subtreeFiles),
    next: entries.slice(0, 5).map((entry) => `fractal-context read ${entry.path}`)
  };
}
function readContext(path, options = {}) {
  const root = resolveRoot(options.root);
  const target = safeResolve(root, path);
  if (!(0, import_fs.existsSync)(target)) throw new Error(`Path not found: ${path}`);
  const st = (0, import_fs.statSync)(target);
  const mode = options.mode ?? "auto";
  if (st.isDirectory()) {
    const agents = parseAgents(root, (0, import_path.join)(target, "AGENTS.md"));
    const entries = listContext(toRel(root, target), { root, depth: 1, max: 30 }).entries;
    return {
      command: "read",
      root,
      path: toRel(root, target),
      kind: "directory",
      mode,
      agents,
      content: entries.map((entry) => `${entry.kind}: ${entry.path}`).join("\n"),
      truncated: false,
      staleSignals: collectStaleSignals(root, walk(root, target, { maxFiles: 300 })),
      next: entries.slice(0, 5).map((entry) => `fractal-context read ${entry.path}`)
    };
  }
  if (isLikelyBinary(target)) throw new Error(`Cannot read binary file: ${path}`);
  const header = parseHeader(target);
  const shouldReadFull = mode === "full" || mode === "auto" && (0, import_path.basename)(target) === "AGENTS.md" || (0, import_path.basename)(target) === "FRACTAL-DOCS.md";
  const full = shouldReadFull ? readText(target, FULL_READ_BYTES) : void 0;
  return {
    command: "read",
    root,
    path: toRel(root, target),
    kind: "file",
    mode,
    header,
    content: full?.text,
    truncated: full?.truncated ?? false,
    staleSignals: collectStaleSignals(root, [target, ...nearestAgents(target, root) ? [nearestAgents(target, root)] : []]),
    next: [`fractal-context list ${toRel(root, (0, import_path.dirname)(target))}`, `fractal-context search ${(0, import_path.basename)(target).split(".")[0]}`]
  };
}
function contains(text, query) {
  return text.toLowerCase().includes(query.toLowerCase());
}
function searchContext(query, options = {}) {
  const root = resolveRoot(options.root);
  const scope = options.scope ?? "docs";
  const max = options.max ?? 20;
  const files = walk(root, root, { maxFiles: SEARCH_SCAN_LIMIT });
  const results = [];
  for (const file of files) {
    if (results.length >= max) break;
    const rel = toRel(root, file);
    const name = (0, import_path.basename)(file);
    if (name === "AGENTS.md") {
      const agents = parseAgents(root, file);
      if (!agents) continue;
      for (const row of agents.businessRows) {
        if (contains(row.raw, query)) {
          results.push({ path: rel, type: "business-domain-row", excerpt: row.raw, score: 100 });
        }
      }
      for (const section of agents.sections) {
        const text = `${section.title}
${section.body}`;
        if (contains(text, query)) {
          results.push({ path: rel, type: "agents-section", excerpt: compactExcerpt(text, query), score: 90 });
        }
      }
    }
  }
  if (scope === "headers" || scope === "all" || scope === "docs") {
    for (const file of files) {
      if (results.length >= max) break;
      if (!isSourceLike(file)) continue;
      const header = parseHeader(file);
      const headerText = header?.lines.join("\n") ?? "";
      if (header && contains(headerText, query)) {
        results.push({ path: toRel(root, file), type: "header", excerpt: compactExcerpt(headerText, query), score: 80 });
      }
    }
  }
  for (const file of files) {
    if (results.length >= max) break;
    if (contains(toRel(root, file), query)) {
      results.push({ path: toRel(root, file), type: "filename", excerpt: toRel(root, file), score: 40 });
    }
  }
  if (scope === "all") {
    for (const file of files) {
      if (results.length >= max) break;
      if (!isSourceLike(file) || isLikelyBinary(file)) continue;
      const { text } = readText(file, HEADER_SCAN_BYTES);
      if (contains(text, query)) {
        results.push({ path: toRel(root, file), type: "source", excerpt: compactExcerpt(text, query), score: 10 });
      }
    }
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    command: "search",
    root,
    query,
    scope,
    results: results.slice(0, max),
    truncated: results.length >= max,
    next: results.slice(0, 5).map((item) => `fractal-context read ${item.path}`)
  };
}
function compactExcerpt(text, query) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const idx = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return normalized.slice(0, 180);
  const start = Math.max(0, idx - 60);
  const end = Math.min(normalized.length, idx + query.length + 100);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}

// src/format.ts
function formatJson(result) {
  return `${JSON.stringify(result, null, 2)}
`;
}
function formatMarkdown(result) {
  switch (result.command) {
    case "status":
      return formatStatus(result);
    case "list":
      return formatList(result);
    case "read":
      return formatRead(result);
    case "search":
      return formatSearch(result);
  }
}
function formatStatus(result) {
  const lines = [
    "# Fractal Context Status",
    "",
    `Root: ${result.root}`,
    `FRACTAL-DOCS.md: ${result.hasProtocol ? "yes" : "no"}`,
    `Root AGENTS.md: ${result.hasRootAgents ? "yes" : "no"}`,
    `AGENTS.md files: ${result.agentsCount}`,
    `Files with headers: ${result.headerCount}`,
    `Scanned files: ${result.scannedFiles}`,
    ""
  ];
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}
`;
}
function formatList(result) {
  const lines = [
    `# Fractal List: ${result.path}`,
    ""
  ];
  if (result.agents?.summary) {
    lines.push("## Summary", "", result.agents.summary, "");
  }
  if (result.agents?.businessRows.length) {
    lines.push("## Business Domains");
    for (const row of result.agents.businessRows.slice(0, 12)) {
      lines.push(`- ${row.path}: ${row.domain}${row.notes ? ` - ${row.notes}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Entries");
  for (const entry of result.entries) {
    if (entry.kind === "directory") {
      lines.push(`- [dir] ${entry.path}${entry.summary ? ` - ${entry.summary}` : ""}`);
    } else {
      lines.push(`- [file] ${entry.path}${formatHeaderInline(entry.header)}`);
    }
  }
  if (result.truncated) lines.push("- [truncated] Narrow path or increase --max");
  lines.push("");
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}
`;
}
function formatRead(result) {
  const lines = [
    `# Fractal Read: ${result.path}`,
    "",
    `Kind: ${result.kind}`,
    ""
  ];
  if (result.agents) {
    if (result.agents.summary) {
      lines.push("## Summary", "", result.agents.summary, "");
    }
    if (result.agents.sections.length) {
      lines.push("## Sections");
      for (const section of result.agents.sections) {
        lines.push(`### ${section.title}`);
        if (section.body) lines.push(section.body);
        lines.push("");
      }
    }
  }
  if (result.header) {
    lines.push("## Header", "", ...result.header.lines, "");
  }
  if (result.content) {
    lines.push("## Content", "", "```text", result.content.trimEnd(), "```", "");
  }
  if (!result.agents && !result.header && !result.content) {
    lines.push("No fractal documentation found for this path.", "");
  }
  if (result.truncated) lines.push("Truncated: yes", "");
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}
`;
}
function formatSearch(result) {
  const lines = [
    `# Fractal Search: ${result.query}`,
    "",
    `Scope: ${result.scope}`,
    ""
  ];
  if (result.results.length === 0) {
    lines.push("No matches.", "");
  } else {
    lines.push("## Results");
    for (const item of result.results) {
      lines.push(`- ${item.type} ${item.path}: ${item.excerpt}`);
    }
    lines.push("");
  }
  if (result.truncated) lines.push("Truncated: yes", "");
  appendNext(lines, result.next);
  return `${lines.join("\n")}
`;
}
function appendSignals(lines, signals) {
  if (signals.length === 0) return;
  lines.push("## Stale Signals");
  for (const signal of signals.slice(0, 20)) {
    lines.push(`- ${signal.detail}`);
  }
  lines.push("");
}
function appendNext(lines, next) {
  if (next.length === 0) return;
  lines.push("## Next:");
  for (const command of next) {
    lines.push(`- ${command}`);
  }
}
function formatHeaderInline(header) {
  if (!header) return "";
  const parts = [header.input && `INPUT: ${header.input}`, header.output && `OUTPUT: ${header.output}`, header.pos && `POS: ${header.pos}`].filter(Boolean);
  return parts.length ? ` - ${parts.join("; ")}` : "";
}

// src/index.ts
async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`${usage()}
`);
    return;
  }
  const parsed = parseArgs(rawArgs);
  let result;
  switch (parsed.command) {
    case "status":
      result = getStatus({ root: parsed.root, max: parsed.max });
      break;
    case "list":
      result = listContext(parsed.path ?? ".", { root: parsed.root, depth: parsed.depth, max: parsed.max });
      break;
    case "read":
      result = readContext(parsed.path, { root: parsed.root, mode: parsed.mode, max: parsed.max });
      break;
    case "search":
      result = searchContext(parsed.query, { root: parsed.root, scope: parsed.scope, max: parsed.max });
      break;
  }
  process.stdout.write(parsed.json ? formatJson(result) : formatMarkdown(result));
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Usage:")) {
    process.stderr.write(`${usage()}
`);
  } else {
    process.stderr.write(`${message}
`);
  }
  process.exit(1);
});
