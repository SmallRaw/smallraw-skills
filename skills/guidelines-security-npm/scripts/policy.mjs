#!/usr/bin/env node

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
      return confirm(
        "npm-registry-write",
        `yarn npm ${nestedCommand} changes externally visible registry state.`,
        "Require explicit approval for the exact package, version, registry, and operation after the supply-chain gate passes.",
      );
    }
  }
  if (ONE_OFF_SUBCOMMANDS[manager]?.has(subcommand)) {
    return deny(
      "one-off-package-runner",
      `${manager} ${subcommand} can download and execute unreviewed package code.`,
      "Review the exact package version with guidelines-security-npm before running it.",
    );
  }
  if (PUBLISH_COMMANDS.has(subcommand)) {
    return confirm(
      "npm-registry-write",
      `${manager} ${subcommand} changes externally visible registry state.`,
      "Require explicit approval for the exact package, version, registry, and operation after the supply-chain gate passes.",
    );
  }
  if (manager === "npm" && subcommand === "audit" && args.includes("fix")) {
    return deny(
      "automatic-audit-fix",
      "npm audit fix changes the resolved dependency graph and may execute package code.",
      "Review the proposed exact dependency changes through the normal supply-chain gate.",
    );
  }
  if (
    manager === "npm" &&
    subcommand === "pkg" &&
    args.some((value) => ["set", "delete", "fix"].includes(value))
  ) {
    return deny(
      "dependency-manifest-change",
      "npm pkg changes package manifest state and may alter dependency resolution.",
      "Review the exact manifest and resulting lockfile changes through the supply-chain gate.",
    );
  }
  if (
    manager === "npm" &&
    ["set-script", "shrinkwrap"].includes(subcommand)
  ) {
    return deny(
      "dependency-manifest-change",
      `npm ${subcommand} changes executable or resolved package state.`,
      "Review the exact manifest and lockfile changes through the supply-chain gate.",
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
        "This command avoids lifecycle scripts but still resolves untrusted dependency metadata.",
        "Run it only in the isolated review workspace, then apply the lockfile preflight and remaining required review levels.",
      );
    }
    if (scriptsDisabled) {
      return confirm(
        "scripts-disabled-install",
        `${manager} ${subcommand || "install"} materializes the dependency graph without running lifecycle scripts.`,
        "Confirm the lockfile and packages are already trusted; the no-execution rule still binds the installed tree until the gate passes.",
      );
    }
    return deny(
      "dependency-state-change",
      `${manager} ${subcommand || "install"} changes or materializes the dependency graph.`,
      "Apply guidelines-security-npm to the exact changed scope before executing installed package code.",
    );
  }
  if (FETCH_COMMANDS.has(subcommand)) {
    if (hasAll(args, ["--ignore-scripts"])) {
      return confirm(
        "artifact-acquisition",
        "Package acquisition is allowed only as static review input in an isolated workspace.",
        "Acquire the exact artifact without scripts, verify integrity, and inspect it before any execution.",
      );
    }
    return deny(
      "artifact-acquisition-with-scripts",
      `${manager} ${subcommand} may run package lifecycle scripts.`,
      "Repeat only in an isolated review workspace with scripts disabled.",
    );
  }
  if (
    (subcommand === "config" &&
      args.some((value) => ["set", "delete", "rm"].includes(value))) ||
    (manager === "npm" && subcommand === "set")
  ) {
    return confirm(
      "package-manager-config-write",
      `${manager} config changes can alter registry, authentication, or execution behavior.`,
      "Review the exact key, scope, and non-secret value before changing configuration.",
    );
  }
  if (manager === "npm" && subcommand === "version") {
    return confirm(
      "package-version-write",
      "npm version changes package metadata and can create Git commits and tags.",
      "Require explicit approval for the exact version and Git effects before running it.",
    );
  }
  if (
    manager === "npm" &&
    subcommand === "pkg" &&
    !args.some((value) => ["get"].includes(value))
  ) {
    return confirm(
      "unclassified-npm-command",
      "This npm pkg operation is not proven read-only.",
      "Inspect the documented manifest effects before proceeding.",
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
      `npm ${subcommand}`.trim() + " is not classified as a trusted routine command.",
      "Inspect the command's documented install, execution, manifest, registry, and lifecycle effects before proceeding.",
    );
  }

  return allow("routine-package-manager-command");
}

function evaluateSegment(segment) {
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

  // pnpm@8.6.0-style invocations resolve to the bare manager name.
  const executable = tokens[0].split("/").at(-1).toLowerCase().split("@")[0];
  if (RUNNERS.has(executable)) {
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
          "npx --offline executes a package from the local npm cache without network access.",
          "Confirm the cached package version was previously reviewed before executing it.",
        );
      }
    }
    return deny(
      "one-off-package-runner",
      `${executable} can download and execute unreviewed package code.`,
      "Run an already reviewed local binary through node_modules/.bin or a package script instead; otherwise pin and review the exact package version with guidelines-security-npm first.",
    );
  }
  if (executable === "corepack") {
    const sub = (tokens[1] ?? "").toLowerCase();
    if (["use", "install", "prepare", "pack", "up", "hydrate"].includes(sub)) {
      return deny(
        "package-manager-acquisition",
        `corepack ${sub} downloads or materializes package manager code.`,
        "Review the exact package manager version through the supply-chain gate before activating it.",
      );
    }
    if (["", "--version", "-v", "help", "--help"].includes(sub)) {
      return allow("routine-package-manager-command");
    }
    return confirm(
      "package-manager-activation",
      `corepack ${sub} changes which package manager binaries execute.`,
      "Confirm the exact corepack change and its effect on binary resolution before proceeding.",
    );
  }
  if (!PACKAGE_MANAGERS.has(executable)) return allow();
  return evaluateManager(executable, tokens.slice(1));
}

export function evaluateCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "The shell command is missing or malformed.",
      "Provide the normalized command without reading credentials or package code.",
    );
  }

  let strongest = allow();
  for (const segment of commandSegments(command)) {
    const result = evaluateSegment(segment);
    if (result.decision === "deny") return result;
    if (result.decision === "confirm") strongest = result;
    else if (strongest.decision === "allow") strongest = result;
  }
  return strongest;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.kind === "command") return input.target ?? input.command ?? null;

  const toolName = String(input.tool_name ?? input.tool ?? "").toLowerCase();
  const toolInput = input.tool_input ?? input.input ?? input.args ?? {};
  if (toolName === "bash" || toolName === "exec_command") {
    return toolInput.command ?? toolInput.cmd ?? null;
  }
  return undefined;
}

export function evaluatePolicy(input) {
  try {
    const command = normalizeInput(input);
    if (command === undefined) return allow("tool-not-covered");
    if (command === null) {
      return deny(
        "invalid-policy-input",
        "Policy input must be a normalized JSON object.",
        "Provide the tool name and command without including credentials.",
      );
    }
    return evaluateCommand(command);
  } catch {
    return deny(
      "policy-evaluation-error",
      "The npm security policy could not classify the operation safely.",
      "Stop before package execution and review the normalized command manually.",
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
        "The npm policy input exceeds its size limit.",
        "Pass only the normalized tool call.",
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
      "The npm policy input is not valid JSON.",
      "Pass one normalized tool-call JSON object.",
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
