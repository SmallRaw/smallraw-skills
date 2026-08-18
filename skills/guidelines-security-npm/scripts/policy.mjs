#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const RUNNERS = new Set(["npx", "bunx"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const MUTATING_COMMANDS = {
  npm: new Set([
    "install",
    "add",
    "i",
    "in",
    "ins",
    "inst",
    "insta",
    "instal",
    "isnt",
    "isnta",
    "isntal",
    "isntall",
    "ci",
    "it",
    "sit",
    "cit",
    "install-test",
    "install-ci-test",
    "update",
    "up",
    "upgrade",
    "uninstall",
    "un",
    "remove",
    "rm",
    "r",
    "dedupe",
    "prune",
    "rebuild",
    "link",
    "unlink",
  ]),
  pnpm: new Set([
    "add",
    "install",
    "i",
    "update",
    "up",
    "remove",
    "rm",
    "prune",
    "link",
    "unlink",
    "import",
    "deploy",
    "approve-builds",
  ]),
  yarn: new Set([
    "add",
    "install",
    "up",
    "upgrade",
    "remove",
    "import",
    "link",
    "unlink",
    "set",
  ]),
  bun: new Set([
    "add",
    "install",
    "i",
    "update",
    "remove",
    "rm",
    "link",
    "unlink",
  ]),
};
const ONE_OFF_SUBCOMMANDS = {
  npm: new Set(["exec", "x", "init", "explore"]),
  pnpm: new Set(["dlx", "create"]),
  yarn: new Set(["dlx", "create"]),
  bun: new Set(["x", "create"]),
};
const PUBLISH_COMMANDS = new Set(["publish", "unpublish", "deprecate", "dist-tag"]);
const FETCH_COMMANDS = new Set(["pack", "fetch"]);
const NPM_ROUTINE_COMMANDS = new Set([
  "",
  "audit",
  "bin",
  "cache",
  "doctor",
  "explain",
  "fund",
  "get",
  "help",
  "help-search",
  "info",
  "list",
  "ll",
  "ls",
  "outdated",
  "ping",
  "prefix",
  "query",
  "root",
  "run",
  "run-script",
  "search",
  "show",
  "start",
  "stop",
  "restart",
  "t",
  "test",
  "view",
  "whoami",
]);

function decision(kind, ruleId, reason, nextAction) {
  const result = { decision: kind, ruleId };
  if (reason) result.reason = reason;
  if (nextAction) result.nextAction = nextAction;
  return result;
}

function allow(ruleId = "not-an-npm-supply-chain-operation") {
  return decision("allow", ruleId);
}

function deny(ruleId, reason, nextAction) {
  return decision("deny", ruleId, reason, nextAction);
}

function confirm(ruleId, reason, nextAction) {
  return decision("confirm", ruleId, reason, nextAction);
}

function tokenize(segment) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;

  for (const character of segment) {
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
    if (/\s/u.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (escaped || quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

// A heredoc body is data delivered to the receiving command, not shell syntax;
// tokenizing it turned every stray quote inside a script body into an
// "unclosed quote" confirm. Splice bodies out before segmenting. A body under
// an unquoted delimiter may still run `$()` or backticks when the shell
// expands it, so those stay in place for the ambiguity handling to see; a
// shell fed by heredoc executes its body, but guidelines-security-shell
// denies bare shell invocations wholesale, so nothing hides there.
function stripHeredocBodies(command) {
  const opener = /<<(-?)(?!<)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([A-Za-z0-9_][\w.-]*))/gu;
  let output = "";
  let cursor = 0;
  let match;
  while ((match = opener.exec(command)) !== null) {
    if (match.index < cursor) continue;
    const literal = match[2] !== undefined || match[3] !== undefined;
    const delimiter = match[2] ?? match[3] ?? match[4];
    const bodyStart = command.indexOf("\n", opener.lastIndex);
    if (bodyStart === -1) continue;
    const terminator = new RegExp(
      `(?:^|\n)${match[1] ? "\t*" : ""}${delimiter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[ \t]*(?=\n|$)`,
      "u",
    );
    const tail = command.slice(bodyStart + 1);
    const found = terminator.exec(tail);
    if (!found) continue;
    const body = tail.slice(0, found.index);
    if (!literal && /`|\$\(/u.test(body)) continue;
    output += command.slice(cursor, bodyStart + 1);
    cursor = bodyStart + 1 + found.index + found[0].length;
  }
  return output + command.slice(cursor);
}

function commandSegments(command) {
  const segments = [];
  let segment = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      segment += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      segment += character;
      escaped = true;
      continue;
    }
    if (quote) {
      segment += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      segment += character;
      quote = character;
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (character === "\n" || character === ";" || character === "|" || character === "&") {
      if (segment.trim()) segments.push(segment.trim());
      segment = "";
      if (pair === "||" || pair === "&&") index += 1;
      continue;
    }
    segment += character;
  }
  if (segment.trim()) segments.push(segment.trim());
  return segments;
}

function stripInvocationPrefixes(tokens) {
  let index = 0;
  if (tokens[index] === "command") index += 1;
  if (tokens[index] === "env") {
    index += 1;
    while (
      index < tokens.length &&
      (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index]))
    ) {
      index += 1;
    }
  }
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) {
    index += 1;
  }
  if (
    tokens[index] === "corepack" &&
    PACKAGE_MANAGERS.has((tokens[index + 1] ?? "").split("@")[0].toLowerCase())
  ) {
    index += 1;
  }
  return tokens.slice(index);
}

function findSubcommand(manager, args) {
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === "--") return args[index + 1] ?? "";
    if (!value.startsWith("-")) return value.toLowerCase();

    if (
      ["--prefix", "--workspace", "--registry", "--cache", "--cwd", "-C"].includes(value)
    ) {
      index += 2;
    } else {
      index += 1;
    }
  }
  return manager === "yarn" ? "install" : "";
}

function hasAll(args, required) {
  return required.every((flag) => args.includes(flag));
}

// `npx tsc` in a repo that already depends on typescript runs node_modules/.bin/tsc
// and fetches nothing — it is the same reviewed code a package script would run,
// just spelled differently. Only an unresolvable name reaches the registry.
function locallyInstalledBinary(args, cwd) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    // These name a package to fetch, or run arbitrary shell, so the first
    // positional no longer says what will actually execute.
    if (/^(?:--package|-p|--call|-c)(?:=|$)/u.test(args[index])) return null;
    index += 1;
  }
  const spec = args[index];
  if (!spec || spec.startsWith("-")) return null;
  // An explicit version always means "go get that one".
  if (spec.lastIndexOf("@") > 0) return null;
  const binary = spec.startsWith("@") ? spec.split("/").at(-1) : spec;
  if (!binary || binary.includes("/") || binary.includes("\\")) return null;

  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, "node_modules", ".bin", binary))) return binary;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function cdTarget(segment, cwd) {
  const tokens = tokenize(segment);
  if (!tokens || tokens[0] !== "cd") return null;
  const target = tokens.find((value, index) => index > 0 && !value.startsWith("-"));
  if (!target) return null;
  const expanded = target.startsWith("~/")
    ? path.join(os.homedir(), target.slice(2))
    : target === "~"
      ? os.homedir()
      : target;
  return path.resolve(cwd || process.cwd(), expanded);
}

function evaluateManager(manager, args) {
  const subcommand = findSubcommand(manager, args);

  if (manager === "yarn" && subcommand === "npm") {
    const nestedIndex = args.findIndex((value) => value.toLowerCase() === "npm");
    const nestedCommand = (args[nestedIndex + 1] ?? "").toLowerCase();
    const nestedAction = (args[nestedIndex + 2] ?? "").toLowerCase();
    if (
      ["publish", "unpublish"].includes(nestedCommand) ||
      (nestedCommand === "tag" && ["add", "remove"].includes(nestedAction))
    ) {
      if (args.includes("--dry-run")) return allow("registry-write-dry-run");
      return confirm(
        "npm-registry-write",
        `yarn npm ${nestedCommand} 会发布或修改 registry 上的包，外部可见。`,
        "确认包名、版本和 registry。",
      );
    }
  }
  if (ONE_OFF_SUBCOMMANDS[manager]?.has(subcommand)) {
    return deny(
      "one-off-package-runner",
      `${manager} ${subcommand} 会下载并执行未经审查的包代码。`,
      "先审查该包版本再运行。",
    );
  }
  // --dry-run reports the would-be upload and touches no registry state; it is
  // the preview to encourage before the real publish. Any lifecycle script it
  // runs is the workspace's own build, the same trust as `npm run build`.
  if (PUBLISH_COMMANDS.has(subcommand) && args.includes("--dry-run")) {
    return allow("registry-write-dry-run");
  }
  if (PUBLISH_COMMANDS.has(subcommand)) {
    return confirm(
      "npm-registry-write",
      `${manager} ${subcommand} 会发布或修改 registry 上的包，外部可见。`,
      "确认包名、版本和 registry。",
    );
  }
  if (manager === "npm" && subcommand === "audit" && args.includes("fix")) {
    return deny(
      "automatic-audit-fix",
      "npm audit fix 会自动改依赖图，并可能执行包代码。",
      "改为手动审查依赖变更。",
    );
  }
  if (
    manager === "npm" &&
    subcommand === "pkg" &&
    args.some((value) => ["set", "delete", "fix"].includes(value))
  ) {
    return deny(
      "dependency-manifest-change",
      "会改写 package.json，影响依赖解析。",
      "走依赖审查流程。",
    );
  }
  if (
    manager === "npm" &&
    ["set-script", "shrinkwrap"].includes(subcommand)
  ) {
    return deny(
      "dependency-manifest-change",
      `npm ${subcommand} 会改变可执行内容或已解析的包状态。`,
      "走依赖审查流程。",
    );
  }
  if (MUTATING_COMMANDS[manager]?.has(subcommand)) {
    const lockfileOnly =
      args.includes("--package-lock-only") || args.includes("--lockfile-only");
    const scriptsDisabled =
      args.includes("--ignore-scripts") ||
      (manager === "yarn" && args.includes("--mode=skip-build"));
    if (lockfileOnly && scriptsDisabled) {
      return confirm(
        "isolated-lockfile-resolution",
        "不执行脚本，但会按未审查的元数据改 lockfile。",
        "仅限隔离工作区，改完跑 lockfile 预检。",
      );
    }
    if (scriptsDisabled) {
      return confirm(
        "scripts-disabled-install",
        `${manager} ${subcommand || "install"} 会安装依赖（已禁用安装脚本）。`,
        "审查通过前不要执行这些包。",
      );
    }
    return deny(
      "dependency-state-change",
      `${manager} ${subcommand || "install"} 会改变或落地依赖图。`,
      "加 --ignore-scripts 重发才可审批。",
    );
  }
  // Dry-run packing the local workspace only lists would-be contents; naming a
  // package still goes through the acquisition gate below.
  if (
    subcommand === "pack" &&
    args.includes("--dry-run") &&
    args.filter((value) => !value.startsWith("-")).length <= 1
  ) {
    return allow("registry-write-dry-run");
  }
  if (FETCH_COMMANDS.has(subcommand)) {
    if (hasAll(args, ["--ignore-scripts"])) {
      return confirm(
        "artifact-acquisition",
        "会下载包文件（不执行脚本）。",
        "仅作审查素材，审完再谈执行。",
      );
    }
    return deny(
      "artifact-acquisition-with-scripts",
      `${manager} ${subcommand} 可能执行包的生命周期脚本。`,
      "加 --ignore-scripts 在隔离工作区重试。",
    );
  }
  if (
    (subcommand === "config" &&
      args.some((value) => ["set", "delete", "rm"].includes(value))) ||
    (manager === "npm" && subcommand === "set")
  ) {
    return confirm(
      "package-manager-config-write",
      `${manager} config 变更会影响 registry、认证或执行行为。`,
      "确认配置项和值。",
    );
  }
  if (manager === "npm" && subcommand === "version") {
    return confirm(
      "package-version-write",
      "会改版本号，可能顺带创建提交和 tag。",
      "确认版本号。",
    );
  }
  if (
    manager === "npm" &&
    subcommand === "pkg" &&
    !args.some((value) => ["get"].includes(value))
  ) {
    return confirm(
      "unclassified-npm-command",
      "不确定该 npm pkg 操作是否只读。",
      "确认后再执行。",
    );
  }
  if (
    manager === "npm" &&
    ((subcommand === "pkg" && args.includes("get")) ||
      (subcommand === "config" &&
        args.some((value) => ["get", "list", "ls"].includes(value))))
  ) {
    return allow("routine-package-manager-command");
  }
  if (manager === "npm" && !NPM_ROUTINE_COMMANDS.has(subcommand)) {
    return confirm(
      "unclassified-npm-command",
      "不确定 " + `npm ${subcommand}`.trim() + " 是否安全。",
      "确认后再执行。",
    );
  }

  return allow("routine-package-manager-command");
}

function evaluateSegment(segment, cwd) {
  const rawTokens = tokenize(segment);
  if (!rawTokens) {
    // Unparseable syntax is one problem, not three: guidelines-security-shell
    // owns the ambiguity confirm, and the gates install together, so this gate
    // stays quiet instead of stacking the same paragraph into the prompt.
    return allow("ambiguity-deferred-to-shell-gate");
  }
  const tokens = stripInvocationPrefixes(rawTokens);
  if (tokens.length === 0) return allow();

  // pnpm@8.6.0-style invocations resolve to the bare manager name.
  const executable = tokens[0].split("/").at(-1).toLowerCase().split("@")[0];
  if (RUNNERS.has(executable)) {
    const local = locallyInstalledBinary(tokens.slice(1), cwd);
    if (local) return allow("installed-binary-runner");
    if (executable === "npx") {
      let index = 1;
      let offline = false;
      while (index < tokens.length && tokens[index].startsWith("-")) {
        if (tokens[index] === "--offline") offline = true;
        index += 1;
      }
      // npm >=7 ignores --no-install/--no and still contacts the registry;
      // only --offline (cache mode only-if-cached) guarantees no download.
      if (offline) {
        return confirm(
          "cache-only-package-runner",
          "会执行 npm 缓存里的包（不联网）。",
          "确认该缓存版本审查过。",
        );
      }
    }
    return deny(
      "one-off-package-runner",
      `${executable} 会下载并执行未经审查的包代码。`,
      "改用 node_modules/.bin 里已装的二进制，或先审查该版本。",
    );
  }
  if (executable === "corepack") {
    const sub = (tokens[1] ?? "").toLowerCase();
    if (["use", "install", "prepare", "pack", "up", "hydrate"].includes(sub)) {
      return deny(
        "package-manager-acquisition",
        `corepack ${sub} 会下载并启用新的包管理器二进制。`,
        "先审查该包管理器版本。",
      );
    }
    if (["", "--version", "-v", "help", "--help"].includes(sub)) {
      return allow("routine-package-manager-command");
    }
    return confirm(
      "package-manager-activation",
      `corepack ${sub} 会改变实际执行的包管理器二进制。`,
      "确认它改的是哪个二进制。",
    );
  }
  if (!PACKAGE_MANAGERS.has(executable)) return allow();
  return evaluateManager(executable, tokens.slice(1));
}

export function evaluateCommand(command, cwd) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "Shell 命令缺失或格式错误。",
      "提供规范化的命令，不要读取凭据或包代码。",
    );
  }

  // `cd repo && npx tsc` resolves the binary from repo, not from where the
  // session happens to sit; follow the cd so the same command is judged the
  // same way however it is spelled.
  let current = cwd;
  let strongest = allow();
  for (const segment of commandSegments(stripHeredocBodies(command))) {
    const moved = cdTarget(segment, current);
    if (moved) {
      current = moved;
      continue;
    }
    const result = evaluateSegment(segment, current);
    if (result.decision === "deny") return result;
    if (result.decision === "confirm") strongest = result;
    else if (strongest.decision === "allow") strongest = result;
  }
  return strongest;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.kind === "command") {
    return { command: input.target ?? input.command ?? null, cwd: input.cwd };
  }

  const toolName = String(input.tool_name ?? input.tool ?? "").toLowerCase();
  const toolInput = input.tool_input ?? input.input ?? input.args ?? {};
  if (toolName === "bash" || toolName === "exec_command") {
    return {
      command: toolInput.command ?? toolInput.cmd ?? null,
      cwd: input.cwd ?? toolInput.cwd ?? toolInput.workdir,
    };
  }
  return undefined;
}

export function evaluatePolicy(input) {
  try {
    const normalized = normalizeInput(input);
    if (normalized === undefined) return allow("tool-not-covered");
    if (normalized === null || normalized.command === null) {
      return deny(
        "invalid-policy-input",
        "策略输入必须是规范化的 JSON 对象。",
        "提供工具名和命令，不要包含凭据。",
      );
    }
    return evaluateCommand(normalized.command, normalized.cwd);
  } catch {
    return deny(
      "policy-evaluation-error",
      "npm 安全策略无法安全地判定该操作。",
      "在执行包代码前停下，手动审查规范化后的命令。",
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
      const result = deny(
        "policy-input-too-large",
        "npm 策略的输入超过大小限制。",
        "只传入规范化的工具调用。",
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    const result = deny(
      "invalid-policy-json",
      "npm 策略的输入不是合法 JSON。",
      "传入一个规范化的工具调用 JSON 对象。",
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
    return;
  }

  const result = evaluatePolicy(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.decision === "allow" ? 0 : result.decision === "confirm" ? 1 : 2;
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
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
