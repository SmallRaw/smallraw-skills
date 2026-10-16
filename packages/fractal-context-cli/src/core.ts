// INPUT: Markdown module knowledge, legacy AGENTS.md files, source paths, and CLI options
// OUTPUT: Structured project context results for status/list/read/search commands
// POS: Core read-only Fractal Context engine shared by CLI and future wrappers

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";

export type CommandName = "status" | "list" | "read" | "search";
export type ReadMode = "auto" | "docs" | "headers" | "full";
export type SearchScope = "docs" | "headers" | "all";
export type NodeKind = "file" | "directory";

export interface HeaderInfo {
  input?: string;
  output?: string;
  pos?: string;
  lines: string[];
}

export interface ContextDoc {
  path: string;
  summary?: string;
  sections: Array<{ title: string; body: string }>;
  businessRows: Array<{ path: string; domain: string; notes: string; raw: string }>;
  mentionedPaths: string[];
  truncated: boolean;
}

export type AgentsDoc = ContextDoc;

export interface StaleSignal {
  type: "missing-protocol" | "missing-root-agents" | "missing-header" | "missing-mentioned-path" | "source-newer-than-agents";
  path: string;
  detail: string;
}

export interface StatusResult {
  command: "status";
  root: string;
  hasProtocol: boolean;
  hasRootAgents: boolean;
  agentsCount: number;
  documentCount: number;
  headerCount: number;
  scannedFiles: number;
  staleSignals: StaleSignal[];
  next: string[];
}

export interface ListEntry {
  path: string;
  kind: NodeKind;
  summary?: string;
  header?: HeaderInfo;
}

export interface ListResult {
  command: "list";
  root: string;
  path: string;
  agents?: AgentsDoc;
  document?: ContextDoc;
  entries: ListEntry[];
  truncated: boolean;
  staleSignals: StaleSignal[];
  next: string[];
}

export interface ReadResult {
  command: "read";
  root: string;
  path: string;
  kind: NodeKind;
  mode: ReadMode;
  agents?: AgentsDoc;
  document?: ContextDoc;
  header?: HeaderInfo;
  content?: string;
  truncated: boolean;
  staleSignals: StaleSignal[];
  next: string[];
}

export interface SearchResultItem {
  path: string;
  type: "doc-section" | "agents-section" | "business-domain-row" | "header" | "filename" | "source";
  excerpt: string;
  score: number;
}

export interface SearchResult {
  command: "search";
  root: string;
  query: string;
  scope: SearchScope;
  results: SearchResultItem[];
  truncated: boolean;
  next: string[];
}

export interface BaseOptions {
  root?: string;
  max?: number;
}

interface IgnoreRules {
  names: Set<string>;
  relPaths: Set<string>;
}

const DEFAULT_MAX_ENTRIES = 80;
const MAX_DEPTH = 3;
const FULL_READ_BYTES = 64 * 1024;
const HEADER_SCAN_BYTES = 16 * 1024;
const STATUS_SCAN_LIMIT = 2000;
const SEARCH_SCAN_LIMIT = 3000;
const DIRECTORY_DOC_NAMES = ["MODULE.md", "README.md", "AGENTS.md"];

const IGNORED_NAMES = new Set([
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

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".kt", ".swift",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".rb",
  ".php", ".sh", ".bash", ".zsh", ".lua", ".dart",
  ".vue", ".svelte"
]);

export function resolveRoot(root?: string): string {
  return resolve(root ?? process.cwd());
}

export function safeResolve(root: string, requested = "."): string {
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return candidate;
  }
  throw new Error(`Path escapes project root: ${requested}`);
}

export function toRel(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  return rel === "" ? "." : rel.split(sep).join("/");
}

function loadIgnoreRules(root: string): IgnoreRules {
  const rules: IgnoreRules = { names: new Set(IGNORED_NAMES), relPaths: new Set() };
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) return rules;

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

function isIgnored(absPath: string, root?: string, rules?: IgnoreRules): boolean {
  const activeRules = rules ?? { names: IGNORED_NAMES, relPaths: new Set<string>() };
  if (absPath.split(sep).some((part) => activeRules.names.has(part))) return true;
  if (!root) return false;
  const rel = toRel(root, absPath);
  for (const ignoredRel of activeRules.relPaths) {
    if (rel === ignoredRel || rel.startsWith(`${ignoredRel}/`)) return true;
  }
  return false;
}

function isLikelyBinary(absPath: string): boolean {
  try {
    const buf = readFileSync(absPath, { encoding: null });
    const sample = buf.subarray(0, Math.min(buf.length, 8000));
    return sample.includes(0);
  } catch {
    return true;
  }
}

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}

function isSourceLike(absPath: string): boolean {
  return SOURCE_EXTENSIONS.has(extensionOf(absPath));
}

function isMarkdown(absPath: string): boolean {
  return /\.(md|markdown)$/i.test(absPath);
}

function directoryDoc(dir: string): string | undefined {
  return DIRECTORY_DOC_NAMES.map((name) => join(dir, name))
    .find((path) => existsSync(path) && statSync(path).isFile());
}

function readText(absPath: string, maxBytes = FULL_READ_BYTES): { text: string; truncated: boolean } {
  const buf = readFileSync(absPath, { encoding: null });
  const truncated = buf.length > maxBytes;
  const chunk = truncated ? buf.subarray(0, maxBytes) : buf;
  return { text: chunk.toString("utf8"), truncated };
}

function listDir(absPath: string): string[] {
  return readdirSync(absPath)
    .filter((name) => !IGNORED_NAMES.has(name))
    .sort((a, b) => a.localeCompare(b));
}

export function parseHeader(absPath: string): HeaderInfo | undefined {
  if (!existsSync(absPath) || statSync(absPath).isDirectory() || isLikelyBinary(absPath)) return undefined;
  const { text } = readText(absPath, HEADER_SCAN_BYTES);
  const lines = text.split(/\r?\n/).slice(0, 80);
  const found: HeaderInfo = { lines: [] };

  for (const line of lines) {
    const cleaned = line
      .replace(/^\s*(\/\/|#|--|;|\*|\/\*+|\*\/)\s?/, "")
      .replace(/^\s*<!--\s?/, "")
      .replace(/\s?-->\s*$/, "")
      .trim();
    const match = cleaned.match(/^(INPUT|OUTPUT|POS)\s*:\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase() as "input" | "output" | "pos";
    found[key] = match[2].trim();
    found.lines.push(`${match[1].toUpperCase()}: ${match[2].trim()}`);
  }

  return found.input || found.output || found.pos ? found : undefined;
}

export function parseDocument(root: string, docPath: string): ContextDoc | undefined {
  if (!existsSync(docPath) || !statSync(docPath).isFile() || isLikelyBinary(docPath)) return undefined;
  const { text, truncated } = readText(docPath, FULL_READ_BYTES);
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; bodyLines: string[] } | undefined;
  let fence: string | undefined;
  const proseLines: string[] = [];
  const preamble: string[] = [];

  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length))) {
      fence = fence ? undefined : marker[1];
      (current?.bodyLines ?? preamble).push(line);
      continue;
    }
    if (fence) {
      (current?.bodyLines ?? preamble).push(line);
      continue;
    }
    proseLines.push(line);
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push({ title: current.title, body: current.bodyLines.join("\n").trim() });
      current = { title: match[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.bodyLines.join("\n").trim() });
  if (preamble.join("\n").trim()) sections.unshift({ title: basename(docPath), body: preamble.join("\n").trim() });
  if (!sections.length && text.trim()) sections.push({ title: basename(docPath), body: text.trim() });

  const summaryText = sections.find((s) => /summary|overview|职责|概览|说明/i.test(s.title))?.body
    ?? proseLines.filter((line) => !/^\s*(#|\|)/.test(line)).join("\n");
  const summary = summaryText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  const businessRows: ContextDoc["businessRows"] = [];
  const mentionedPaths = new Set<string>();
  let pathColumn = -1;
  let tableWidth = 0;
  for (let index = 0; index < proseLines.length; index++) {
    const line = proseLines[index];
    if (!line.trim().startsWith("|")) {
      pathColumn = -1;
      continue;
    }
    // Keep path-table compatibility, not a Markdown validator. Ambiguous rows
    // remain available in the document body without guessed structured paths.
    const cells = tableCells(line);
    if (!cells) continue;
    if (pathColumn < 0) {
      const separator = tableCells(proseLines[index + 1] ?? "");
      if (!separator || separator.length !== cells.length || !separator.every((cell) => /^:?-+:?$/.test(cell))) continue;
      pathColumn = cells.findIndex((cell) => /^(path|files?|file\/directory|路径|文件名|文件(?:\/子目录|\/目录)?|文件路径)$/i.test(cell));
      tableWidth = cells.length;
      index++;
      continue;
    }
    if (cells.length !== tableWidth) continue;
    const pathCell = literalTablePath(cells[pathColumn]);
    if (!pathCell) continue;
    const rest = cells.filter((_, index) => index !== pathColumn);
    businessRows.push({
      path: pathCell,
      domain: rest[0] ?? "",
      notes: rest.slice(1).join(" | "),
      raw: line.trim()
    });
    mentionedPaths.add(pathCell);
  }

  return {
    path: toRel(root, docPath),
    summary,
    sections,
    businessRows,
    mentionedPaths: [...mentionedPaths],
    truncated
  };
}

// Kept for callers consuming the original AGENTS-based API.
export const parseAgents = parseDocument;

function tableCells(line: string): string[] | undefined {
  if (!line.trim().startsWith("|") || line.includes("\\|")) return undefined;
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function literalTablePath(cell: string): string | undefined {
  const code = cell.match(/^`([^`]+)`$/);
  const path = code?.[1] ?? cell;
  if (!path || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(path) || /[*?{}]/.test(path)) return undefined;
  if (!code && /[\s`\[\]()<>\\]/.test(path)) return undefined;
  return path;
}

function walk(root: string, start: string, options: { maxFiles?: number; includeDirs?: boolean } = {}): string[] {
  const maxFiles = options.maxFiles ?? STATUS_SCAN_LIMIT;
  const result: string[] = [];
  const stack = [start];
  const rules = loadIgnoreRules(root);

  while (stack.length > 0 && result.length < maxFiles) {
    const current = stack.pop()!;
    if (isIgnored(current, root, rules) || !existsSync(current)) continue;
    const st = lstatSync(current);
    if (st.isDirectory()) {
      if (options.includeDirs) result.push(current);
      const children = listDir(current).map((name) => join(current, name)).reverse();
      stack.push(...children);
    } else {
      result.push(current);
    }
  }

  return result.filter((p) => p === root || !isIgnored(p, root, rules));
}

function nearestDocument(path: string, root: string): string | undefined {
  let current = statSync(path).isDirectory() ? path : dirname(path);
  while (true) {
    const candidate = directoryDoc(current);
    if (candidate) return candidate;
    if (current === root) return undefined;
    const next = dirname(current);
    if (next === current) return undefined;
    current = next;
  }
}

function collectStaleSignals(root: string, files: string[]): StaleSignal[] {
  const signals: StaleSignal[] = [];

  for (const docPath of files.filter(isMarkdown)) {
    const parsed = parseDocument(root, docPath);
    if (!parsed) continue;
    const base = dirname(docPath);
    for (const mentioned of parsed.mentionedPaths) {
      const target = resolve(base, mentioned);
      // Documentation may link outside the checkout; only check project-local paths.
      const rel = relative(root, target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      if (!existsSync(target)) {
        signals.push({
          type: "missing-mentioned-path",
          path: toRel(root, docPath),
          detail: `${toRel(root, docPath)} mentions missing path: ${mentioned}`
        });
      }
    }
  }

  return signals.slice(0, 50);
}

export function getStatus(options: BaseOptions = {}): StatusResult {
  const root = resolveRoot(options.root);
  const files = walk(root, root, { maxFiles: STATUS_SCAN_LIMIT });
  const agentsCount = files.filter((file) => basename(file) === "AGENTS.md").length;
  const headerCount = files.filter((file) => isSourceLike(file) && parseHeader(file)).length;
  const staleSignals = collectStaleSignals(root, files);
  const docPath = directoryDoc(root);

  return {
    command: "status",
    root,
    hasProtocol: existsSync(join(root, "FRACTAL-DOCS.md")),
    hasRootAgents: existsSync(join(root, "AGENTS.md")),
    agentsCount,
    documentCount: files.filter(isMarkdown).length,
    headerCount,
    scannedFiles: files.length,
    staleSignals,
    next: ["fractal-context list", ...(docPath ? [`fractal-context read ${toRel(root, docPath)}`] : [])]
  };
}

function nextReads(paths: string[]): string[] {
  return [...new Set(paths)].slice(0, 5).map((path) => `fractal-context read ${quoteArgument(path)}`);
}

function quoteArgument(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function listContext(path = ".", options: BaseOptions & { depth?: number } = {}): ListResult {
  const root = resolveRoot(options.root);
  const target = safeResolve(root, path);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`List path is not a directory: ${path}`);
  }
  const requestedDepth = Math.min(Math.max(options.depth ?? 1, 1), MAX_DEPTH);
  const max = options.max ?? DEFAULT_MAX_ENTRIES;
  const entries: ListEntry[] = [];
  const ignoreRules = loadIgnoreRules(root);

  function visit(dir: string, depth: number) {
    if (entries.length >= max) return;
    for (const name of listDir(dir)) {
      if (entries.length >= max) return;
      const child = join(dir, name);
      if (isIgnored(child, root, ignoreRules)) continue;
      const st = lstatSync(child);
      if (st.isDirectory()) {
        const docPath = directoryDoc(child);
        const document = docPath ? parseDocument(root, docPath) : undefined;
        entries.push({ path: toRel(root, child), kind: "directory", summary: document?.summary });
        if (depth < requestedDepth) visit(child, depth + 1);
      } else {
        entries.push({ path: toRel(root, child), kind: "file", header: parseHeader(child) });
      }
    }
  }

  visit(target, 1);
  const subtreeFiles = walk(root, target, { maxFiles: max * 10 });
  const docPath = directoryDoc(target);
  const document = docPath ? parseDocument(root, docPath) : undefined;

  return {
    command: "list",
    root,
    path: toRel(root, target),
    document,
    agents: docPath && basename(docPath) === "AGENTS.md" ? document : undefined,
    entries,
    truncated: entries.length >= max,
    staleSignals: collectStaleSignals(root, subtreeFiles),
    next: nextReads([...(docPath ? [toRel(root, docPath)] : []), ...entries.map((entry) => entry.path)])
  };
}

export function readContext(path: string, options: BaseOptions & { mode?: ReadMode } = {}): ReadResult {
  const root = resolveRoot(options.root);
  const target = safeResolve(root, path);
  if (!existsSync(target)) throw new Error(`Path not found: ${path}`);
  const st = statSync(target);
  const mode = options.mode ?? "auto";

  if (st.isDirectory()) {
    const docPath = directoryDoc(target);
    const document = docPath ? parseDocument(root, docPath) : undefined;
    const listing = listContext(toRel(root, target), { root, depth: 1, max: 30 });
    const entries = listing.entries;
    return {
      command: "read",
      root,
      path: toRel(root, target),
      kind: "directory",
      mode,
      document,
      agents: docPath && basename(docPath) === "AGENTS.md" ? document : undefined,
      content: entries.map((entry) => `${entry.kind}: ${entry.path}`).join("\n"),
      truncated: (document?.truncated ?? false) || listing.truncated,
      staleSignals: collectStaleSignals(root, walk(root, target, { maxFiles: 300 })),
      next: nextReads([...(docPath ? [toRel(root, docPath)] : []), ...entries.map((entry) => entry.path)])
    };
  }

  if (isLikelyBinary(target)) throw new Error(`Cannot read binary file: ${path}`);
  const header = parseHeader(target);
  const docPath = nearestDocument(target, root);
  const document = mode === "docs" && !isMarkdown(target) && docPath ? parseDocument(root, docPath) : undefined;
  const shouldReadFull = mode === "full" || ((mode === "auto" || mode === "docs") && isMarkdown(target));
  const full = shouldReadFull ? readText(target, FULL_READ_BYTES) : undefined;

  return {
    command: "read",
    root,
    path: toRel(root, target),
    kind: "file",
    mode,
    document,
    agents: document && basename(document.path) === "AGENTS.md" ? document : undefined,
    header,
    content: full?.text,
    truncated: (full?.truncated ?? false) || (document?.truncated ?? false),
    staleSignals: collectStaleSignals(root, [...new Set([target, ...(docPath ? [docPath] : [])])]),
    next: [...(docPath && docPath !== target ? nextReads([toRel(root, docPath)]) : []), `fractal-context list ${quoteArgument(toRel(root, dirname(target)))}`, `fractal-context search ${quoteArgument(basename(target).split(".")[0])}`]
  };
}

function contains(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

export function searchContext(query: string, options: BaseOptions & { scope?: SearchScope } = {}): SearchResult {
  const root = resolveRoot(options.root);
  const scope = options.scope ?? "docs";
  const max = options.max ?? 20;
  const files = walk(root, root, { maxFiles: SEARCH_SCAN_LIMIT });
  const results: SearchResultItem[] = [];
  let truncated = files.length >= SEARCH_SCAN_LIMIT;

  for (const file of files) {
    if (results.length >= max) break;
    const rel = toRel(root, file);
    const name = basename(file);
    if (scope !== "headers" && isMarkdown(file)) {
      const document = parseDocument(root, file);
      if (!document) continue;
      truncated ||= document.truncated;
      for (const row of document.businessRows) {
        if (contains(row.raw, query)) {
          results.push({ path: rel, type: "business-domain-row", excerpt: row.raw, score: 100 });
        }
      }
      for (const section of document.sections) {
        const text = `${section.title}\n${section.body}`;
        if (contains(text, query)) {
          results.push({ path: rel, type: name === "AGENTS.md" ? "agents-section" : "doc-section", excerpt: compactExcerpt(text, query), score: 90 });
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
      const { text, truncated: sourceTruncated } = readText(file, HEADER_SCAN_BYTES);
      truncated ||= sourceTruncated;
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
    truncated: truncated || results.length >= max,
    next: nextReads(results.map((item) => item.path))
  };
}

function compactExcerpt(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const idx = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return normalized.slice(0, 180);
  const start = Math.max(0, idx - 60);
  const end = Math.min(normalized.length, idx + query.length + 100);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}
