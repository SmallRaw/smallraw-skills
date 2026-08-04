#!/usr/bin/env node

import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const PRIVILEGE_ESCALATION = new Set(["sudo", "su", "doas"]);
const SHELLS = new Set(["sh", "bash", "zsh", "ksh", "dash", "fish"]);
const PROCESS_SWEEPERS = new Set(["killall", "pkill"]);
const DELETERS = new Set(["rm", "unlink"]);
const OWNERSHIP_COMMANDS = new Set(["chmod", "chown", "chgrp"]);
// Deleting or re-permissioning these roots takes out the system or the user's
// whole world; no interactive confirmation makes that reasonable.
const CRITICAL_ROOTS = new Set([
  "/",
  "/applications",
  "/bin",
  "/dev",
  "/etc",
  "/home",
  "/library",
  "/opt",
  "/private",
  "/sbin",
  "/system",
  "/users",
  "/usr",
  "/var",
  "/volumes",
]);
// Fetching and running third-party code is the same risk whatever ecosystem it
// comes from. guidelines-security-npm reviews the npm graph in depth; these have
// no equivalent pipeline, so they get a look rather than a full gate.
const FOREIGN_INSTALLERS = [
  { match: (exe, args) => ["pip", "pip3", "uv"].includes(exe) && args.includes("install") },
  {
    match: (exe, args) =>
      ["python", "python3"].includes(exe) &&
      args.includes("pip") &&
      args.includes("install"),
  },
  { match: (exe, args) => exe === "cargo" && args[0] === "install" },
  { match: (exe, args) => exe === "go" && args[0] === "install" },
  { match: (exe, args) => exe === "gem" && args[0] === "install" },
  {
    match: (exe, args) =>
      exe === "brew" && ["install", "reinstall", "upgrade", "tap"].includes(args[0]),
  },
  {
    match: (exe, args) =>
      ["apt", "apt-get", "dnf", "yum", "pacman", "apk"].includes(exe) &&
      args.some((value) => ["install", "-S", "add"].includes(value)),
  },
];
const DISK_ERASE_VERBS = new Set([
  "erasedisk",
  "erasevolume",
  "partitiondisk",
  "zerodisk",
  "secureerase",
  "resetfusion",
]);

function result(decision, ruleId, reason, nextAction) {
  const value = { decision, ruleId };
  if (reason) value.reason = reason;
  if (nextAction) value.nextAction = nextAction;
  return value;
}

function allow(ruleId = "not-a-destructive-command") {
  return result("allow", ruleId);
}

function confirm(ruleId, reason, nextAction) {
  return result("confirm", ruleId, reason, nextAction);
}

function deny(ruleId, reason, nextAction) {
  return result("deny", ruleId, reason, nextAction);
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
  let changed = true;
  while (changed && index < tokens.length) {
    changed = false;
    if (tokens[index] === "command" || tokens[index] === "nohup" || tokens[index] === "nice" || tokens[index] === "caffeinate") {
      index += 1;
      changed = true;
      continue;
    }
    if (tokens[index] === "timeout" && /^\d/u.test(tokens[index + 1] ?? "")) {
      index += 2;
      changed = true;
      continue;
    }
    if (tokens[index] === "xargs") {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
      changed = true;
      continue;
    }
    if (tokens[index] === "env") {
      index += 1;
      while (
        index < tokens.length &&
        (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index]))
      ) {
        index += 1;
      }
      changed = true;
      continue;
    }
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) {
      index += 1;
      changed = true;
    }
  }
  return tokens.slice(index);
}

function expandHome(target) {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2));
  if (target === "$HOME" || target === "${HOME}") return os.homedir();
  if (target.startsWith("$HOME/")) return path.join(os.homedir(), target.slice(6));
  if (target.startsWith("${HOME}/")) return path.join(os.homedir(), target.slice(8));
  return target;
}

function workspaceRootFor(cwd) {
  const base = path.resolve(cwd || process.cwd());
  try {
    return realpathSync(base);
  } catch {
    return base;
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTempPath(resolved) {
  const roots = [os.tmpdir(), "/tmp", "/private/tmp", "/private/var/folders", "/var/folders"];
  return roots.some((root) => {
    if (isWithin(resolved, root)) return true;
    try {
      return isWithin(resolved, realpathSync(root));
    } catch {
      return false;
    }
  });
}

function isCriticalRoot(resolved) {
  const normalized = resolved.replace(/\/+$/u, "") || "/";
  if (CRITICAL_ROOTS.has(normalized.toLowerCase())) return true;
  const home = path.resolve(os.homedir());
  return normalized === home;
}

// Returns "critical" | "outside" | "inside" | "unknown" for a set of path targets.
function classifyTargets(targets, cwd) {
  if (targets.length === 0) return "unknown";
  const workspace = workspaceRootFor(cwd);
  let outside = false;
  for (const raw of targets) {
    if (raw === "/*" || raw === "/**") return "critical";
    const resolved = path.resolve(cwd || process.cwd(), expandHome(raw));
    if (isCriticalRoot(resolved)) return "critical";
    if (!isWithin(resolved, workspace) && !isTempPath(resolved)) outside = true;
  }
  return outside ? "outside" : "inside";
}

function pathTargets(args) {
  const targets = [];
  let noMoreFlags = false;
  for (const value of args) {
    if (!noMoreFlags && value === "--") {
      noMoreFlags = true;
      continue;
    }
    if (!noMoreFlags && value.startsWith("-")) continue;
    targets.push(value);
  }
  return targets;
}

function evaluateDeletion(executable, args, cwd) {
  const scope = classifyTargets(pathTargets(args), cwd);
  if (scope === "critical") {
    return deny(
      "critical-root-deletion",
      `${executable} 的目标是系统根目录或主目录本身。`,
      "绝不删除系统根目录或整个主目录；请写明确切的、属于自己的路径。",
    );
  }
  if (scope === "inside") return allow("workspace-deletion");
  return confirm(
    scope === "unknown" ? "unknown-scope-deletion" : "outside-workspace-deletion",
    scope === "unknown"
      ? `${executable} 没有明确的路径目标，删除范围未知。`
      : `${executable} 会删除当前工作区之外的路径。`,
    "写明确切路径，确认这些内容确实归你删除，并优先使用工作区内的相对路径。",
  );
}

function evaluateOwnership(executable, args, cwd) {
  const targets = pathTargets(args).slice(1); // first positional is the mode/owner
  const scope = classifyTargets(targets, cwd);
  if (scope === "critical") {
    return deny(
      "critical-root-permission-change",
      `${executable} 会改写系统根目录或主目录本身的权限。`,
      "绝不修改系统根目录的权限；只改动确切的、属于自己的路径。",
    );
  }
  if (scope === "inside") return allow("workspace-permission-change");
  return confirm(
    "outside-workspace-permission-change",
    `${executable} 会改变当前工作区之外的权限或归属。`,
    "修改前确认确切的路径和目标权限。",
  );
}

function evaluateSegment(segment, cwd) {
  const rawTokens = tokenize(segment);
  if (!rawTokens) {
    return confirm(
      "ambiguous-shell-syntax",
      "命令存在未闭合的引号，无法安全分类。",
      "请提供规范化的可执行文件和参数，或先简化命令再审查。",
    );
  }
  const tokens = stripInvocationPrefixes(rawTokens);
  if (tokens.length === 0) return allow();

  const executable = tokens[0].split("/").at(-1).toLowerCase();
  const args = tokens.slice(1);

  if (PRIVILEGE_ESCALATION.has(executable)) {
    return deny(
      "privilege-escalation",
      `${executable} 会把权限提升到 Agent 被授予的范围之外。`,
      "说明为何需要提升权限，并交由用户自己执行。",
    );
  }
  if (executable === "shred") {
    return deny(
      "data-destruction",
      "shred 会不可恢复地销毁文件内容。",
      "若确实需要删除，请对确切的、属于自己的路径使用普通删除。",
    );
  }
  if (executable === "mkfs" || executable.startsWith("mkfs.")) {
    return deny(
      "disk-destruction",
      "mkfs 会重新格式化设备并销毁其中所有内容。",
      "绝不格式化设备；说明需求后停下。",
    );
  }
  if (executable === "dd") {
    if (args.some((value) => /^of=\/dev\//iu.test(value))) {
      return deny(
        "disk-destruction",
        "dd 写入块设备会销毁设备上的内容。",
        "绝不写入块设备；说明需求后停下。",
      );
    }
    return confirm(
      "raw-copy",
      "dd 是裸复制，可能静默覆盖文件。",
      "运行前确认确切的 if=/of= 目标。",
    );
  }
  if (executable === "diskutil") {
    const verb = (args.find((value) => !value.startsWith("-")) ?? "").toLowerCase();
    if (["list", "info", "activity"].includes(verb) || verb === "") {
      return allow("read-only-diskutil");
    }
    if (DISK_ERASE_VERBS.has(verb) || (verb === "apfs" && /delete/iu.test(args.join(" ")))) {
      return deny(
        "disk-destruction",
        `diskutil ${verb} 会抹除存储或重新分区。`,
        "绝不抹除或重新分区磁盘；说明需求后停下。",
      );
    }
    return confirm(
      "disk-state-change",
      `diskutil ${verb} 会改变磁盘或卷的状态。`,
      "继续前确认确切的设备和操作。",
    );
  }
  if (FOREIGN_INSTALLERS.some((entry) => entry.match(executable, args))) {
    return confirm(
      "foreign-package-install",
      `${executable} 会从外部仓库下载并执行第三方代码。`,
      "确认包名、来源与版本；这类生态没有 npm 那样的深度审查流程，所以由你把关。",
    );
  }
  if (DELETERS.has(executable)) return evaluateDeletion(executable, args, cwd);
  if (OWNERSHIP_COMMANDS.has(executable)) return evaluateOwnership(executable, args, cwd);
  if (PROCESS_SWEEPERS.has(executable)) {
    return confirm(
      "process-sweep",
      `${executable} 按模式匹配终止进程，可能误杀无关进程。`,
      "确认确切的匹配模式，或改用 kill 指定具体 PID。",
    );
  }
  if (executable === "docker" || executable === "podman") {
    const verbs = args.filter((value) => !value.startsWith("-")).map((value) => value.toLowerCase());
    if (
      ["rm", "rmi"].includes(verbs[0]) ||
      (verbs[0] === "system" && verbs[1] === "prune") ||
      (verbs[0] === "volume" && verbs[1] === "rm") ||
      (verbs[0] === "container" && verbs[1] === "rm") ||
      (verbs[0] === "image" && ["rm", "prune"].includes(verbs[1]))
    ) {
      return confirm(
        "container-destruction",
        `${executable} ${verbs.slice(0, 2).join(" ")} 会销毁可能含有数据的容器、镜像或数据卷。`,
        "删除前确认确切的容器、镜像或数据卷。",
      );
    }
    return allow();
  }
  if (executable === "twine" && (args[0] ?? "").toLowerCase() === "upload") {
    return confirm(
      "package-publish",
      "twine upload 会把包发布到外部 registry。",
      "就确切的包名、版本和 registry 取得明确批准。",
    );
  }
  if (executable === "eval") {
    return deny(
      "shell-indirection",
      "eval 会执行动态拼接的内容，策略无法对其分类。",
      "直接执行底层命令，好让它能被分类。",
    );
  }
  if (SHELLS.has(executable)) {
    if (args.length === 0 || args.includes("-c") || args.includes("-i")) {
      return deny(
        "shell-indirection",
        `${executable} ${args.includes("-c") ? "-c 包裹的命令策略无法分类" : "会启动无法分类的交互式 shell"}。`,
        "直接执行内层命令，好让它能被分类。",
      );
    }
    return allow("script-execution");
  }

  return allow();
}

export function evaluateCommand(command, cwd) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "Shell 命令缺失或格式错误。",
      "提供规范化的命令。",
    );
  }

  let strongest = allow();
  for (const segment of commandSegments(command)) {
    const value = evaluateSegment(segment, cwd);
    if (value.decision === "deny") return value;
    if (value.decision === "confirm") strongest = value;
    else if (strongest.decision === "allow") strongest = value;
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
  const cwd = input.cwd ?? toolInput.cwd ?? toolInput.workdir;
  if (toolName === "bash" || toolName === "exec_command") {
    return { command: toolInput.command ?? toolInput.cmd ?? null, cwd };
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
        "策略输入必须包含规范化的 shell 命令。",
        "提供工具名和命令。",
      );
    }
    return evaluateCommand(normalized.command, normalized.cwd);
  } catch {
    return deny(
      "policy-evaluation-error",
      "Shell 策略无法安全地判定该操作。",
      "在执行破坏性操作前停下，手动检查规范化后的命令。",
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
      const value = deny(
        "policy-input-too-large",
        "Shell 策略的输入超过大小限制。",
        "只传入规范化的工具调用。",
      );
      process.stdout.write(`${JSON.stringify(value)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    const value = deny(
      "invalid-policy-json",
      "Shell 策略的输入不是合法 JSON。",
      "传入一个规范化的工具调用 JSON 对象。",
    );
    process.stdout.write(`${JSON.stringify(value)}\n`);
    process.exitCode = 2;
    return;
  }

  const value = evaluatePolicy(input);
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = value.decision === "allow" ? 0 : value.decision === "confirm" ? 1 : 2;
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
