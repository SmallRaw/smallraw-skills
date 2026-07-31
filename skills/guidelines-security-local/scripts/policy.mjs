#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const DENIED_DOMAINS = new Set([
  "agents.md",
  "tools.md",
  "claude.md",
  "rules.md",
  "system.md",
  "prompt.md",
  "instructions.md",
  "identity.md",
  "soul.md",
  "bootstrap.md",
  "heartbeat.md",
  "conventions.md",
  "install.sh",
  "setup.sh",
  "init.sh",
  "bootstrap.sh",
  "run.sh",
  "main.rs",
  "mod.rs",
  "build.rs",
  "config.rs",
  "setup.rs",
  "install.rs",
  "utils.rs",
  "test.rs",
  "app.rs",
  "server.rs",
]);
const TRUSTED_FILELIKE_DOMAINS = new Set(["docs.rs", "crates.rs", "lib.rs"]);
const CREDENTIAL_STORE_DIRECTORY_NAMES = new Set([".ssh", ".gnupg", ".aws", ".kube"]);
// Matched only by name, not by proven content: inside the workspace these
// confirm with the user instead of denying absolutely.
const NAME_HEURISTIC_DIRECTORY_NAMES = new Set([
  "secret",
  "secrets",
  "credential",
  "credentials",
  "private-key",
  "private-keys",
  "keychains",
]);
const NAME_HEURISTIC_EXTENSIONS = new Set([".tfstate", ".tfvars"]);
const PROTECTED_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".kdbx",
  ".crash",
  ".dmp",
]);
// Source, docs, and test files routinely discuss passwords without holding one;
// only non-code files named after a secret are treated as protected.
const CODE_LIKE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cs",
  ".php",
  ".sh",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".md",
  ".mdx",
  ".sql",
  ".proto",
  ".snap",
]);
const PROTECTED_BASENAMES = new Set([
  ".npmrc",
  ".pnpmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".bash_history",
  ".zsh_history",
  ".python_history",
  ".node_repl_history",
  ".lesshst",
  ".viminfo",
  "credentials.json",
]);
const PROTECTED_HOME_PREFIXES = [
  [".config", "gh"],
  [".config", "glab-cli"],
  [".config", "gcloud"],
  [".config", "1password"],
  [".config", "bitwarden"],
  [".config", "op"],
  [".azure"],
  [".docker"],
  [".local", "share", "keyrings"],
  ["library", "application support", "1password"],
  ["library", "application support", "bitwarden"],
  ["library", "application support", "google", "chrome"],
  ["library", "application support", "chromium"],
  ["library", "application support", "firefox", "profiles"],
  ["library", "cookies"],
  ["library", "group containers", "2bua8c4s2c.com.1password"],
  ["library", "keychains"],
  ["library", "safari"],
];

function allow(ruleId = "not-protected") {
  return { decision: "allow", ruleId };
}

function deny(ruleId, reason, nextAction) {
  return { decision: "deny", ruleId, reason, nextAction };
}

function blocked(ruleId, reason) {
  return deny(
    ruleId,
    reason,
    "Use a sanitized example, redacted output, non-secret schema, synthetic placeholder, or a user-run diagnostic that returns only a non-sensitive result.",
  );
}

function confirmDecision(ruleId, reason, nextAction) {
  return { decision: "confirm", ruleId, reason, nextAction };
}

const DECISION_RANK = { allow: 0, confirm: 1, deny: 2 };

function strongerOf(first, second) {
  return DECISION_RANK[second.decision] > DECISION_RANK[first.decision] ? second : first;
}

function workspaceRootFor(cwd) {
  const base = path.resolve(cwd || process.cwd());
  try {
    return fs.realpathSync.native(base);
  } catch {
    return base;
  }
}

function isWithinWorkspace(resolved, workspaceRoot) {
  const relative = path.relative(workspaceRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWithoutReading(target, cwd) {
  const absolute = path.resolve(cwd || process.cwd(), target);
  let existing = absolute;
  const suffix = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }

  try {
    const realBase = fs.realpathSync.native(existing);
    return path.resolve(realBase, ...suffix);
  } catch {
    return absolute;
  }
}

function startsWithSegments(candidate, prefix) {
  return prefix.every((segment, index) => candidate[index] === segment);
}

function expandHomePath(target) {
  if (target === "~") return os.homedir();
  if (target.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), target.slice(2));
  }
  if (target.startsWith(`$HOME${path.sep}`)) {
    return path.join(os.homedir(), target.slice(6));
  }
  if (target.startsWith(`\${HOME}${path.sep}`)) {
    return path.join(os.homedir(), target.slice(8));
  }
  return target;
}

function isCoreDumpFile(resolvedPath, basename) {
  if (basename !== "core" && !/^core\.\d+$/u.test(basename)) return false;
  // Directories and source files commonly named core (packages/core, core.ts)
  // are not dumps; only an existing regular file can hold process memory.
  try {
    return fs.statSync(resolvedPath).isFile();
  } catch {
    return false;
  }
}

function classifyAbsolutePath(resolved, inWorkspace) {
  const segments = resolved
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) ?? "";
  const extension = path.extname(basename);

  if (
    (basename === ".env" || basename.startsWith(".env.")) &&
    // Template conventions carry no live values; .env.example.production stays blocked.
    !/\.(?:example|sample|template)$/u.test(basename)
  ) {
    return blocked("protected-env-file", "Access to .env files is prohibited.");
  }
  if (segments.some((segment) => CREDENTIAL_STORE_DIRECTORY_NAMES.has(segment))) {
    return blocked(
      "protected-directory",
      "Access to protected credential, key, or secret directories is prohibited.",
    );
  }
  if (
    PROTECTED_EXTENSIONS.has(extension) ||
    PROTECTED_BASENAMES.has(basename) ||
    basename.startsWith(".yarnrc") ||
    /^client_secret.*\.json$/u.test(basename) ||
    /^service[-_]account.*\.json$/u.test(basename) ||
    (/(?:^|[-_. ])(?:password|passwd|passphrase)s?(?:[-_. ]|$)/u.test(
      basename.slice(0, basename.length - extension.length) || basename,
    ) &&
      !CODE_LIKE_EXTENSIONS.has(extension)) ||
    isCoreDumpFile(resolved, basename)
  ) {
    return blocked(
      "protected-credential-file",
      "Access to protected authentication, key, keystore, or infrastructure state files is prohibited.",
    );
  }

  const home = path.resolve(os.homedir());
  const relativeHome = path.relative(home, resolved);
  if (
    relativeHome !== "" &&
    !relativeHome.startsWith("..") &&
    !path.isAbsolute(relativeHome)
  ) {
    const homeSegments = relativeHome
      .split(path.sep)
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());
    if (
      PROTECTED_HOME_PREFIXES.some((prefix) =>
        startsWithSegments(homeSegments, prefix),
      ) ||
      homeSegments[0] === ".zsh_sessions"
    ) {
      return blocked(
        "protected-authentication-store",
        "Access to authentication stores, browser login data, keychains, or shell sessions is prohibited.",
      );
    }
  }

  if (
    segments.some((segment) => NAME_HEURISTIC_DIRECTORY_NAMES.has(segment)) ||
    NAME_HEURISTIC_EXTENSIONS.has(extension) ||
    basename === "terraform.tfstate" ||
    basename.startsWith("terraform.tfstate.")
  ) {
    if (inWorkspace) {
      return confirmDecision(
        "workspace-name-heuristic",
        "This workspace path is matched only by a secret-like name and may hold real secrets.",
        "Proceed only after the user explicitly confirms this exact path holds no real secrets.",
      );
    }
    return blocked(
      "name-heuristic-path",
      "Access to secret-like named paths outside the workspace is prohibited.",
    );
  }

  return allow();
}

export function evaluatePath(target, cwd = process.cwd()) {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0")) {
    return blocked("invalid-path-input", "The requested path is missing or malformed.");
  }

  const expanded = expandHomePath(target);
  const lexical = path.resolve(cwd, expanded);
  const resolved = resolveWithoutReading(expanded, cwd);
  // Workspace membership follows the real filesystem location, so symlinked
  // roots such as macOS /var -> /private/var compare consistently.
  const inWorkspace = isWithinWorkspace(resolved, workspaceRootFor(cwd));
  const lexicalDecision = classifyAbsolutePath(lexical, inWorkspace);
  if (lexicalDecision.decision === "deny") return lexicalDecision;

  if (resolved !== lexical) {
    return strongerOf(lexicalDecision, classifyAbsolutePath(resolved, inWorkspace));
  }
  return lexicalDecision;
}

function normalizedHostname(url) {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function isTrustedDomainLookalike(hostname, trusted) {
  return (
    hostname.endsWith(`.${trusted}`) ||
    hostname.startsWith(`${trusted}.`) ||
    hostname.includes(`.${trusted}.`)
  );
}

export function evaluateUrl(target) {
  if (typeof target !== "string" || target.length === 0) {
    return blocked("invalid-url-input", "The requested network target is missing.");
  }
  if (/[\u0000-\u001f\u007f\\]/u.test(target)) {
    return blocked(
      "ambiguous-url",
      "The requested network target contains ambiguous or unsafe URL characters.",
    );
  }

  const trimmed = target.trim();
  const bareHost = trimmed.toLowerCase().replace(/\.$/, "");
  if (!trimmed.includes("://") && DENIED_DOMAINS.has(bareHost)) {
    return blocked(
      "filelike-name-is-local",
      "The requested name is a local filename, not a network host.",
    );
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return blocked("invalid-url", "The requested network target is not a valid URL.");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return blocked(
      "unsupported-network-scheme",
      "Only an explicitly reviewed HTTP or HTTPS target may be considered.",
    );
  }
  if (parsed.username || parsed.password) {
    return blocked(
      "url-userinfo",
      "URLs with user information are prohibited because they can disguise the real host.",
    );
  }

  const hostname = normalizedHostname(parsed);
  if (TRUSTED_FILELIKE_DOMAINS.has(hostname)) {
    return allow("trusted-filelike-domain");
  }
  for (const trusted of TRUSTED_FILELIKE_DOMAINS) {
    if (isTrustedDomainLookalike(hostname, trusted)) {
      return blocked(
        "trusted-domain-lookalike",
        "The requested host is not the exact trusted file-like domain.",
      );
    }
  }
  for (const denied of DENIED_DOMAINS) {
    if (hostname === denied || hostname.endsWith(`.${denied}`)) {
      return blocked(
        "filelike-domain",
        "The requested host is a prohibited file-like domain.",
      );
    }
  }

  return allow();
}

function collectValues(value, keyPattern, output = []) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && keyPattern.test(key)) {
      output.push(child);
    } else if (child && typeof child === "object") {
      collectValues(child, keyPattern, output);
    }
  }
  return output;
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character) || [";", "|", "&"].includes(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (token) tokens.push(token);
  return tokens;
}

function pathCandidateFromToken(token) {
  let candidate = token.replace(/^\d*[<>]+/u, "");
  const assignment = candidate.match(/^[A-Za-z_][A-Za-z0-9_]*=(.+)$/u);
  if (assignment) candidate = assignment[1];
  if (candidate.startsWith("-") && candidate.includes("=")) {
    candidate = candidate.slice(candidate.indexOf("=") + 1);
  }
  if (!candidate.includes("://")) {
    const gitObject = candidate.match(/^[^/:]+:(.+)$/u);
    if (gitObject) candidate = gitObject[1];
  }
  if (!candidate || candidate.startsWith("@") || candidate.includes("://")) return null;

  const basename = path.basename(candidate).toLowerCase();
  const looksLikePath =
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith("~") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    PROTECTED_BASENAMES.has(basename) ||
    PROTECTED_EXTENSIONS.has(path.extname(basename)) ||
    NAME_HEURISTIC_EXTENSIONS.has(path.extname(basename));
  return looksLikePath ? candidate : null;
}

function evaluateCommand(command, cwd) {
  if (typeof command !== "string") {
    return blocked("invalid-command-input", "The shell command is missing.");
  }

  if (
    // Only invocations that print the environment: bare `env`/`set` (or `env` with
    // only flags) dump variables; `env VAR=x cmd` and `set -e` do not. For ps, env
    // display is BSD-style dashless `e` or capital `-E`, not `-e`/`-ef` (select all).
    /(?:^|[;&|]\s*)env(?:\s+-[^\s;&|]*)*\s*(?:$|[;&|])/iu.test(command) ||
    /(?:^|[;&|]\s*)set\s*(?:$|[;&|])/iu.test(command) ||
    /(?:^|[;&|]\s*)printenv(?:\s|$)/iu.test(command) ||
    /(?:^|[;&|]\s*)export\s+-p(?:\s|$)/iu.test(command) ||
    /\/proc\/(?:self|\d+)\/environ/iu.test(command) ||
    // Inline-eval bodies may contain quoted `;`, so match inside one quoted or
    // whitespace-free argument rather than stopping at shell separators.
    /(?:^|[;&|]\s*)(?:node|bun)\s+[^;&|]*(?:-e|--eval|-p|--print)\s+(?:'[^']*process\.env|"[^"]*process\.env|[^\s;&|]*process\.env)/iu.test(
      command,
    ) ||
    /(?:^|[;&|]\s*)deno\s+eval\s+(?:'[^']*|"[^"]*|[^\s;&|]*)(?:deno\.env|process\.env)/iu.test(
      command,
    ) ||
    /(?:^|[;&|]\s*)python[\w.]*\s+[^;&|]*-c\s+(?:'[^']*os\.environ|"[^"]*os\.environ|[^\s;&|]*os\.environ)/iu.test(
      command,
    ) ||
    /(?:^|[;&|]\s*)ps\s+(?:[^\s;&|]+\s+)*?(?:-[^\s;&|]*E[^\s;&|]*|(?![-\d])[A-Za-z]*e[A-Za-z]*)(?:$|[\s;&|])/u.test(command)
  ) {
    return blocked(
      "process-environment-access",
      "Dumping process or shell environment data is prohibited.",
    );
  }

  let strongest = allow();
  for (const token of shellTokens(command)) {
    const candidate = pathCandidateFromToken(token);
    if (!candidate) continue;
    const pathDecision = evaluatePath(candidate, cwd);
    if (pathDecision.decision === "deny") {
      return blocked(
        "protected-path-in-command",
        `The shell command references protected local content (${pathDecision.ruleId}).`,
      );
    }
    strongest = strongerOf(strongest, pathDecision);
  }

  if (
    /(?:^|[\/\\:])\.env(?:$|[\/\\\s'"]|\.(?![\w.-]*(?:example|sample|template)(?:[\/\\\s'"]|$)))/iu.test(command) ||
    /(?:^|[\/\\])(?:\.ssh|\.gnupg)(?:[\/\\\s'"]|$)/iu.test(command) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)(?:\s|$|['"])/iu.test(
      command,
    ) ||
    /(?:\.npmrc|\.yarnrc\S*|\.pnpmrc|\.pypirc|\.netrc|\.git-credentials|\.zsh_history|\.bash_history)/iu.test(
      command,
    )
  ) {
    return blocked(
      "protected-path-in-command",
      "The shell command references protected local content.",
    );
  }

  if (
    strongest.decision === "allow" &&
    (/(?:^|[\/\\])(?:secrets?|credentials?|private-keys?)(?:[\/\\\s'"]|$)/iu.test(command) ||
      /\.(?:tfvars|tfstate)(?:\s|$|['"])/iu.test(command))
  ) {
    strongest = confirmDecision(
      "workspace-name-heuristic",
      "The shell command references a path matched only by a secret-like name.",
      "Proceed only after the user explicitly confirms the exact path holds no real secrets.",
    );
  }

  for (const match of command.matchAll(/https?:\/\/[^\s'"`]+/giu)) {
    const decision = evaluateUrl(match[0]);
    if (decision.decision === "deny") return decision;
  }
  if (
    /(?:^|[;&|]\s*)(?:curl|wget)(?:\s+[^;&|\n]*)?\s+(?:https?:\/\/)?(?:[A-Za-z0-9_-]+\.)*(?:agents|tools|claude|rules|system|prompt|instructions|identity|soul|bootstrap|heartbeat|conventions)\.md\.?(?:[\/:\s'"]|$)/iu.test(
      command,
    ) ||
    /(?:^|[;&|]\s*)(?:curl|wget)(?:\s+[^;&|\n]*)?\s+(?:https?:\/\/)?(?:[A-Za-z0-9_-]+\.)*(?:install|setup|init|bootstrap|run)\.sh\.?(?:[\/:\s'"]|$)/iu.test(
      command,
    ) ||
    /(?:^|[;&|]\s*)(?:curl|wget)(?:\s+[^;&|\n]*)?\s+(?:https?:\/\/)?(?:[A-Za-z0-9_-]+\.)*(?:main|mod|build|config|setup|install|utils|test|app|server)\.rs\.?(?:[\/:\s'"]|$)/iu.test(
      command,
    )
  ) {
    return blocked(
      "filelike-domain-in-network-command",
      "The network command targets a prohibited file-like domain.",
    );
  }

  return strongest;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Policy input must be a JSON object." };
  }
  if (input.kind && input.target !== undefined) {
    return {
      kind: input.kind,
      target: input.target,
      cwd: input.cwd,
    };
  }

  const toolName = String(input.tool_name ?? input.tool ?? "").toLowerCase();
  const toolInput = input.tool_input ?? input.input ?? input.args ?? {};
  const operationCwd = input.cwd ?? toolInput.cwd ?? toolInput.workdir;
  if (toolName === "bash" || toolName === "exec_command") {
    return {
      kind: "command",
      target: toolInput.command ?? toolInput.cmd,
      cwd: operationCwd,
    };
  }
  if (toolName.includes("webfetch") || toolName === "webfetch") {
    return {
      kind: "url",
      target: toolInput.url ?? toolInput.ref_id,
      cwd: operationCwd,
    };
  }

  const urls = collectValues(toolInput, /(?:^|_)(?:url|uri|href)$/iu);
  const paths = collectValues(
    toolInput,
    /(?:^|_)(?:path|file|filename|file_path|notebook_path)$/iu,
  );
  if (urls.length > 0 && paths.length > 0) {
    return { kind: "targets", urls, paths, cwd: operationCwd };
  }
  if (urls.length > 0) {
    return { kind: "urls", targets: urls, cwd: operationCwd };
  }
  if (paths.length > 0) {
    return { kind: "paths", targets: paths, cwd: operationCwd };
  }
  return { kind: "other" };
}

export function evaluatePolicy(input) {
  try {
    const normalized = normalizeInput(input);
    if (normalized.error) {
      return blocked("invalid-policy-input", normalized.error);
    }
    if (normalized.kind === "path") {
      return evaluatePath(normalized.target, normalized.cwd);
    }
    if (normalized.kind === "paths") {
      let strongest = allow();
      for (const target of normalized.targets) {
        const decision = evaluatePath(target, normalized.cwd);
        if (decision.decision === "deny") return decision;
        strongest = strongerOf(strongest, decision);
      }
      return strongest;
    }
    if (normalized.kind === "url") {
      return evaluateUrl(normalized.target);
    }
    if (normalized.kind === "targets") {
      let strongest = allow();
      for (const target of normalized.paths) {
        const decision = evaluatePath(target, normalized.cwd);
        if (decision.decision === "deny") return decision;
        strongest = strongerOf(strongest, decision);
      }
      for (const target of normalized.urls) {
        const decision = evaluateUrl(target);
        if (decision.decision === "deny") return decision;
      }
      return strongest;
    }
    if (normalized.kind === "urls") {
      for (const target of normalized.targets) {
        const decision = evaluateUrl(target);
        if (decision.decision === "deny") return decision;
      }
      return allow();
    }
    if (normalized.kind === "command") {
      return evaluateCommand(normalized.target, normalized.cwd);
    }
    return allow("tool-not-covered");
  } catch {
    return blocked(
      "policy-evaluation-error",
      "The local security policy could not evaluate the operation safely.",
    );
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Read one normalized tool-call JSON object from stdin and emit allow/confirm/deny JSON. Deny exits 2; confirm exits 1.\n",
    );
    return;
  }

  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) {
      const decision = blocked(
        "policy-input-too-large",
        "The local security policy input exceeds its size limit.",
      );
      process.stdout.write(`${JSON.stringify(decision)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    const decision = blocked(
      "invalid-policy-json",
      "The local security policy input is not valid JSON.",
    );
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exitCode = 2;
    return;
  }

  const decision = evaluatePolicy(input);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exitCode =
    decision.decision === "allow" ? 0 : decision.decision === "confirm" ? 1 : 2;
}

// Node resolves symlinks when loading a module, so import.meta.url is the real
// path while argv[1] is whatever the caller typed. Comparing them directly makes
// the gate silently do nothing when invoked through a symlinked skill directory —
// exit 0, no verdict, which reads as "allowed". Compare resolved paths instead.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(self);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
