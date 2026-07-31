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
      `${executable} targets a system root or the home directory itself.`,
      "Never delete system roots or the whole home directory; name the exact owned paths instead.",
    );
  }
  if (scope === "inside") return allow("workspace-deletion");
  return confirm(
    scope === "unknown" ? "unknown-scope-deletion" : "outside-workspace-deletion",
    scope === "unknown"
      ? `${executable} has no explicit path targets, so the deletion scope is unknown.`
      : `${executable} deletes paths outside the current workspace.`,
    "Name the exact paths, confirm they are yours to delete, and prefer workspace-relative targets.",
  );
}

function evaluateOwnership(executable, args, cwd) {
  const targets = pathTargets(args).slice(1); // first positional is the mode/owner
  const scope = classifyTargets(targets, cwd);
  if (scope === "critical") {
    return deny(
      "critical-root-permission-change",
      `${executable} rewrites permissions on a system root or the home directory itself.`,
      "Never re-permission system roots; change only exact owned paths.",
    );
  }
  if (scope === "inside") return allow("workspace-permission-change");
  return confirm(
    "outside-workspace-permission-change",
    `${executable} changes permissions or ownership outside the current workspace.`,
    "Confirm the exact paths and desired mode before changing them.",
  );
}

function evaluateSegment(segment, cwd) {
  const rawTokens = tokenize(segment);
  if (!rawTokens) {
    return confirm(
      "ambiguous-shell-syntax",
      "The command contains unmatched quoting and cannot be classified safely.",
      "Provide the normalized executable and argv, or simplify the command before review.",
    );
  }
  const tokens = stripInvocationPrefixes(rawTokens);
  if (tokens.length === 0) return allow();

  const executable = tokens[0].split("/").at(-1).toLowerCase();
  const args = tokens.slice(1);

  if (PRIVILEGE_ESCALATION.has(executable)) {
    return deny(
      "privilege-escalation",
      `${executable} escalates privileges beyond the agent's granted scope.`,
      "Report why elevated access seems needed and let the user run it themselves.",
    );
  }
  if (executable === "shred") {
    return deny(
      "data-destruction",
      "shred irrecoverably destroys file contents.",
      "Use a normal deletion of an exact owned path if removal is actually needed.",
    );
  }
  if (executable === "mkfs" || executable.startsWith("mkfs.")) {
    return deny(
      "disk-destruction",
      "mkfs reformats a device and destroys its contents.",
      "Never format devices; report the need and stop.",
    );
  }
  if (executable === "dd") {
    if (args.some((value) => /^of=\/dev\//iu.test(value))) {
      return deny(
        "disk-destruction",
        "dd writing to a block device destroys its contents.",
        "Never write block devices; report the need and stop.",
      );
    }
    return confirm(
      "raw-copy",
      "dd performs raw copies that can silently overwrite files.",
      "Confirm the exact if=/of= targets before running it.",
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
        `diskutil ${verb} erases or repartitions storage.`,
        "Never erase or repartition disks; report the need and stop.",
      );
    }
    return confirm(
      "disk-state-change",
      `diskutil ${verb} changes disk or volume state.`,
      "Confirm the exact device and operation before proceeding.",
    );
  }
  if (DELETERS.has(executable)) return evaluateDeletion(executable, args, cwd);
  if (OWNERSHIP_COMMANDS.has(executable)) return evaluateOwnership(executable, args, cwd);
  if (PROCESS_SWEEPERS.has(executable)) {
    return confirm(
      "process-sweep",
      `${executable} terminates processes by pattern and can hit unrelated ones.`,
      "Confirm the exact match pattern, or target a specific PID with kill instead.",
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
        `${executable} ${verbs.slice(0, 2).join(" ")} destroys containers, images, or volumes that may hold data.`,
        "Confirm the exact containers, images, or volumes before removing them.",
      );
    }
    return allow();
  }
  if (executable === "twine" && (args[0] ?? "").toLowerCase() === "upload") {
    return confirm(
      "package-publish",
      "twine upload publishes packages to an external registry.",
      "Require explicit approval for the exact package, version, and registry.",
    );
  }
  if (executable === "eval") {
    return deny(
      "shell-indirection",
      "eval executes dynamically assembled input that the policy cannot classify.",
      "Run the underlying command directly so it can be classified.",
    );
  }
  if (SHELLS.has(executable)) {
    if (args.length === 0 || args.includes("-c") || args.includes("-i")) {
      return deny(
        "shell-indirection",
        `${executable} ${args.includes("-c") ? "-c wraps commands the policy cannot classify" : "starts an unclassifiable interactive shell"}.`,
        "Run the inner command directly so it can be classified.",
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
      "The shell command is missing or malformed.",
      "Provide the normalized command.",
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
        "Policy input must contain a normalized shell command.",
        "Provide the tool name and command.",
      );
    }
    return evaluateCommand(normalized.command, normalized.cwd);
  } catch {
    return deny(
      "policy-evaluation-error",
      "The shell policy could not classify the operation safely.",
      "Stop before destructive action and inspect the normalized command manually.",
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
        "The shell policy input exceeds its size limit.",
        "Pass only the normalized tool call.",
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
      "The shell policy input is not valid JSON.",
      "Pass one normalized tool-call JSON object.",
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
