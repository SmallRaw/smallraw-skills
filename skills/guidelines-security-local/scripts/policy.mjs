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
const CREDENTIAL_STORE_DIRECTORY_NAMES = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  ".password-store",
]);
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
// A workspace source file under a directory merely NAMED secret is ordinary
// code — wallet repos keep crypto sources in src/secret/ — and value-bearing
// files never wear a source extension. Data formats (.json, .yaml, .txt) are
// deliberately absent: secrets/config.json keeps its look.
const SOURCE_CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".md",
  ".mjs",
  ".mm",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);
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
const PROTECTED_BASENAMES = new Set([
  ".npmrc",
  ".pnpmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  // Established credential stores, matched by their exact conventional names
  // rather than a "password" substring that mostly hits ordinary source files.
  ".htpasswd",
  ".pgpass",
  ".my.cnf",
  ".authinfo",
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
    "改用脱敏示例，或由用户自己执行。",
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
    return blocked("protected-env-file", "禁止访问 .env 文件。");
  }
  if (segments.some((segment) => CREDENTIAL_STORE_DIRECTORY_NAMES.has(segment))) {
    return blocked(
      "protected-directory",
      "禁止访问受保护的凭据、密钥或机密目录。",
    );
  }
  if (
    PROTECTED_EXTENSIONS.has(extension) ||
    PROTECTED_BASENAMES.has(basename) ||
    basename.startsWith(".yarnrc") ||
    /^client_secret.*\.json$/u.test(basename) ||
    /^service[-_]account.*\.json$/u.test(basename) ||
    // Only the system shadow file itself; "shadow" is too common a directory name.
    resolved === "/etc/shadow" ||
    isCoreDumpFile(resolved, basename)
  ) {
    return blocked(
      "protected-credential-file",
      "禁止访问受保护的认证、密钥、keystore 或基础设施状态文件。",
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
        "禁止访问认证仓库、浏览器登录数据、钥匙串或 shell 会话记录。",
      );
    }
  }

  if (
    NAME_HEURISTIC_EXTENSIONS.has(extension) ||
    basename === "terraform.tfstate" ||
    basename.startsWith("terraform.tfstate.") ||
    (segments.some((segment) => NAME_HEURISTIC_DIRECTORY_NAMES.has(segment)) &&
      // Outside the workspace the directory name keeps its full weight.
      !(inWorkspace && SOURCE_CODE_EXTENSIONS.has(extension)))
  ) {
    if (inWorkspace) {
      return confirmDecision(
        "workspace-name-heuristic",
        "路径名看起来像机密文件，可能含真实密钥。",
        "确认这个路径里没有真实密钥。",
      );
    }
    return blocked(
      "name-heuristic-path",
      "禁止访问工作区之外、名称疑似机密的路径。",
    );
  }

  return allow();
}

export function evaluatePath(target, cwd = process.cwd()) {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0")) {
    return blocked("invalid-path-input", "请求的路径缺失或格式错误。");
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
    return blocked("invalid-url-input", "请求的网络目标缺失。");
  }
  if (/[\u0000-\u001f\u007f\\]/u.test(target)) {
    return blocked(
      "ambiguous-url",
      "请求的网络目标包含有歧义或不安全的 URL 字符。",
    );
  }

  const trimmed = target.trim();
  const bareHost = trimmed.toLowerCase().replace(/\.$/, "");
  if (!trimmed.includes("://") && DENIED_DOMAINS.has(bareHost)) {
    return blocked(
      "filelike-name-is-local",
      "请求的名称是本地文件名，不是网络主机。",
    );
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return blocked("invalid-url", "请求的网络目标不是合法 URL。");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return blocked(
      "unsupported-network-scheme",
      "只有经过明确审查的 HTTP 或 HTTPS 目标才可考虑。",
    );
  }
  if (parsed.username || parsed.password) {
    return blocked(
      "url-userinfo",
      "禁止带用户信息的 URL，因为它会掩盖真实主机。",
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
        "请求的主机不是那个确切的可信文件名域名。",
      );
    }
  }
  for (const denied of DENIED_DOMAINS) {
    if (hostname === denied || hostname.endsWith(`.${denied}`)) {
      return blocked(
        "filelike-domain",
        "请求的主机是被禁止的文件名伪装域名。",
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

// The raw-command sweep backs up token scanning for spellings tokens miss, but
// it must agree with classifyAbsolutePath: a workspace source file under a
// directory merely named secret reads as code, not as a candidate secret.
function commandMentionsHeuristicName(command, cwd) {
  const pattern = /(?:^|[\/\\])(?:secrets?|credentials?|private-keys?)(?:[\/\\\s'"]|$)/iu;
  if (!pattern.test(command)) return false;
  const workspaceRoot = workspaceRootFor(cwd);
  for (const word of command.split(/[\s'"]+/u)) {
    if (!pattern.test(word)) continue;
    if (
      SOURCE_CODE_EXTENSIONS.has(path.extname(word).toLowerCase()) &&
      isWithinWorkspace(resolveWithoutReading(expandHomePath(word), cwd), workspaceRoot)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function evaluateCommand(command, cwd) {
  if (typeof command !== "string") {
    return blocked("invalid-command-input", "Shell 命令缺失。");
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
      "禁止导出进程或 shell 的环境变量数据。",
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
        `该 shell 命令引用了受保护的本地内容（${pathDecision.ruleId}）。`,
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
      "该 shell 命令引用了受保护的本地内容。",
    );
  }

  if (
    strongest.decision === "allow" &&
    (commandMentionsHeuristicName(command, cwd) ||
      /\.(?:tfvars|tfstate)(?:\s|$|['"])/iu.test(command))
  ) {
    strongest = confirmDecision(
      "workspace-name-heuristic",
      "命令引用了名字像机密文件的路径。",
      "确认这个路径里没有真实密钥。",
    );
  }

  // Stop at a backslash or pipe: in `grep -iE "http://|https://|cdn\."` those
  // are regex syntax, and swallowing them turned a search into a bad-URL denial.
  for (const match of command.matchAll(/https?:\/\/[^\s'"`\\|]+/giu)) {
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
      "该网络命令指向被禁止的文件名伪装域名。",
    );
  }

  return strongest;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "策略输入必须是一个 JSON 对象。" };
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
      "本地安全策略无法安全地判定该操作。",
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
        "本地安全策略的输入超过大小限制。",
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
      "本地安全策略的输入不是合法 JSON。",
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
