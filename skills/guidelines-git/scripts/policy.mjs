#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const READ_ONLY_GIT_COMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "cat-file",
  "blame",
  "grep",
  "name-rev",
  "shortlog",
  "for-each-ref",
  "count-objects",
  "fsck",
  "merge-base",
  "rev-list",
  "describe",
  "check-ignore",
  "check-attr",
  "check-mailmap",
  "show-ref",
  "ls-remote",
  "diff-tree",
  "diff-index",
  "diff-files",
  "cherry",
  "var",
]);
const HISTORY_OR_BRANCH_MUTATIONS = new Set([
  "checkout",
  "switch",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "reset",
  "restore",
  "clean",
  "stash",
  "replace",
  "update-ref",
  "symbolic-ref",
]);
const REMOTE_MUTATIONS = new Set(["push", "pull", "clone"]);
const GH_WRITE_GROUPS = new Map([
  ["pr", new Set(["create", "comment", "merge", "close", "edit", "ready", "reopen", "review"])],
  ["issue", new Set(["create", "comment", "close", "edit", "reopen", "transfer"])],
  ["release", new Set(["create", "delete", "edit", "upload"])],
  ["repo", new Set(["archive", "delete", "edit", "fork", "rename", "sync"])],
  ["workflow", new Set(["disable", "enable", "run"])],
  ["run", new Set(["cancel", "delete", "rerun"])],
  ["gist", new Set(["create", "delete", "edit"])],
  ["label", new Set(["clone", "create", "delete", "edit"])],
  ["secret", new Set(["delete", "set"])],
  ["variable", new Set(["delete", "set"])],
]);

function result(decision, ruleId, reason, nextAction) {
  const value = { decision, ruleId };
  if (reason) value.reason = reason;
  if (nextAction) value.nextAction = nextAction;
  return value;
}

function allow(ruleId = "not-a-git-mutation") {
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
  return tokens.slice(index);
}

function gitSubcommand(args) {
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (!value.startsWith("-")) return { subcommand: value.toLowerCase(), args: args.slice(index + 1) };
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(value)) index += 2;
    else index += 1;
  }
  return { subcommand: "", args: [] };
}

function isReadOnlyBranch(args) {
  return (
    args.length === 0 ||
    args.some(
      (value) =>
        [
          "--list",
          "--show-current",
          "--contains",
          "--merged",
          "--no-merged",
          "--all",
          "--remotes",
          "--verbose",
        ].includes(value) || /^-[alrv]+$/u.test(value),
    )
  );
}

function isReadOnlyTag(args) {
  return (
    args.length === 0 ||
    args.some(
      (value) =>
        ["--list", "-l", "--contains", "--points-at"].includes(value) ||
        /^-n\d*$/u.test(value),
    )
  );
}

function isReadOnlyRemote(args) {
  return (
    args.length === 0 ||
    args.every((value) => ["-v", "--verbose"].includes(value)) ||
    ["get-url", "show"].includes(args[0])
  );
}

function isReadOnlyConfig(args) {
  return args.some((value) =>
    ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin", "--show-scope"].includes(value),
  );
}

function isBroadStageToken(value) {
  return (
    [
      ".",
      "./",
      ":",
      ":/",
      "-A",
      "--all",
      "-u",
      "--update",
      "--pathspec-from-file",
    ].includes(value) ||
    value.startsWith("--pathspec-from-file=") ||
    value.startsWith(":(") ||
    value.startsWith(":!") ||
    value.startsWith(":^") ||
    /[*?[]/u.test(value)
  );
}

function evaluateGit(args) {
  const parsed = gitSubcommand(args);
  const subcommand = parsed.subcommand;
  const rest = parsed.args;

  if (!subcommand || READ_ONLY_GIT_COMMANDS.has(subcommand)) {
    return allow("read-only-git");
  }
  if (subcommand === "branch" && isReadOnlyBranch(rest)) return allow("read-only-git");
  if (subcommand === "tag" && isReadOnlyTag(rest)) return allow("read-only-git");
  if (subcommand === "remote" && isReadOnlyRemote(rest)) return allow("read-only-git");
  if (subcommand === "config" && isReadOnlyConfig(rest)) return allow("read-only-git");
  if (subcommand === "reflog" && (rest.length === 0 || rest[0] === "show" || rest[0].startsWith("-"))) {
    return allow("read-only-git");
  }
  if (subcommand === "stash" && ["list", "show"].includes(rest[0] ?? "")) {
    return allow("read-only-git");
  }
  if (subcommand === "worktree" && rest[0] === "list") return allow("read-only-git");
  if (
    subcommand === "symbolic-ref" &&
    !rest.includes("-d") &&
    !rest.includes("--delete") &&
    rest.filter((value) => !value.startsWith("-")).length <= 1
  ) {
    return allow("read-only-git");
  }

  if (subcommand === "add") {
    if (rest.some(isBroadStageToken)) {
      return confirm(
        "broad-staging",
        "Broad staging can capture unrelated user-owned changes.",
        "Inspect the index and stage only the exact paths belonging to the current coherent change.",
      );
    }
    return allow("explicit-staging");
  }
  if (subcommand === "commit") {
    if (
      rest.includes("--amend") ||
      rest.some((value) => value.startsWith("--fixup"))
    ) {
      return confirm(
        "history-rewrite",
        "Amending or fixup commits changes existing history.",
        "Require explicit authorization for the exact commit and inspect the staged diff first.",
      );
    }
    if (
      rest.some((value) =>
        ["--only", "-o", "--include", "-i", "--pathspec-from-file"].includes(value) ||
        value.startsWith("--pathspec-from-file="),
      )
    ) {
      return confirm(
        "commit-pathspec",
        "Committing a pathspec can bypass or combine with the inspected index.",
        "Inspect the exact pathspec, worktree diff, and staged diff before authorizing the commit.",
      );
    }
    if (
      rest.includes("--all") ||
      rest.some((value) => /^-[^-]*a/iu.test(value))
    ) {
      return confirm(
        "broad-staging",
        "git commit --all stages tracked changes that may be user-owned.",
        "Inspect the index and stage only the exact paths or hunks belonging to the current coherent change.",
      );
    }
    return allow("normal-commit");
  }
  if (subcommand === "config") {
    if (args.includes("--global") || args.includes("--system")) {
      return deny(
        "global-git-config-write",
        "Global or system Git configuration can change identity and credentials for unrelated repositories.",
        "Use repository-local configuration only, after inspecting the existing local value.",
      );
    }
    return confirm(
      "repository-git-config-write",
      "Repository Git configuration changes identity, transport, or command behavior.",
      "Confirm the exact local key and non-secret value before changing it.",
    );
  }
  if (subcommand === "push") {
    const joined = rest.join(" ");
    if (
      /(?:https?:\/\/github\.com(?:\/|$)|ssh:\/\/(?:git@)?github\.com(?:\/|$)|(?:git@)?github\.com:)/iu.test(
        joined,
      )
    ) {
      return deny(
        "default-github-transport",
        "The default github.com transport does not prove this directory's configured SSH identity.",
        "Use the repository's configured push remote and directory-specific SSH host alias; do not fall back to HTTPS, tokens, or another identity.",
      );
    }
    return confirm(
      rest.some((value) => value === "--force" || value === "-f" || value.startsWith("--force-with-lease"))
        ? "force-push"
        : "git-push",
      "Pushing changes remote state and requires exact authorization.",
      "Confirm the repository push remote, SSH host alias, destination ref, and commit range before pushing.",
    );
  }
  if (subcommand === "fetch") {
    if (rest.some((value) => !value.startsWith("-") && value.includes(":"))) {
      return confirm(
        "fetch-local-ref-update",
        "A fetch refspec with a destination can update local refs.",
        "Confirm the exact refspec and affected local refs before fetching.",
      );
    }
    return allow("fetch-remote-tracking");
  }
  if (REMOTE_MUTATIONS.has(subcommand)) {
    return confirm(
      "remote-or-worktree-mutation",
      `git ${subcommand} changes local refs, history, or filesystem state.`,
      "Require explicit authorization for the exact remote, ref, destination, and affected worktree.",
    );
  }
  if (HISTORY_OR_BRANCH_MUTATIONS.has(subcommand)) {
    return confirm(
      "history-or-branch-mutation",
      `git ${subcommand} can change branches, history, the index, or user-owned worktree changes.`,
      "Inspect status and diffs, then require explicit authorization for the exact affected refs and paths.",
    );
  }
  if (["branch", "tag", "remote", "worktree", "submodule", "init"].includes(subcommand)) {
    return confirm(
      "repository-structure-mutation",
      `git ${subcommand} can change repository refs, remotes, configuration, or worktrees.`,
      "Confirm the exact mutation and its scope before proceeding.",
    );
  }

  return confirm(
    "unclassified-git-command",
    `git ${subcommand} is not classified as read-only.`,
    "Inspect the command's documented effects and require authorization if it mutates repository or remote state.",
  );
}

function evaluateGh(args) {
  const group = (args[0] ?? "").toLowerCase();
  const action = (args[1] ?? "").toLowerCase();

  if (group === "auth") {
    if (action === "status") return allow("read-only-gh");
    return deny(
      action === "setup-git" ? "gh-auth-setup-git" : "gh-auth-mutation",
      "GitHub CLI authentication changes can replace or bypass this directory's SSH identity.",
      "Do not change or reuse default gh authentication; use the repository's configured SSH identity.",
    );
  }
  if (group === "api") {
    const methodIndex = args.findIndex((value) => value === "--method" || value === "-X");
    const explicitMethod =
      methodIndex >= 0 ? String(args[methodIndex + 1] ?? "").toUpperCase() : "";
    const writeFlag =
      args.includes("--input") ||
      args.includes("--raw-field") ||
      args.includes("-f") ||
      args.includes("-F") ||
      args.some((value) =>
        /^(?:--input=|--raw-field=|--field=|-f.+|-F.+|-X(?!GET$).+)/iu.test(value),
      ) ||
      (explicitMethod !== "" && explicitMethod !== "GET") ||
      args.some((value) => /^--method=(?!GET$)/iu.test(value));
    if (writeFlag) {
      return deny(
        "default-gh-write",
        "A GitHub API write through default gh authentication is prohibited.",
        "Use the directory-specific authorized identity and obtain explicit approval for the exact write.",
      );
    }
    return allow("read-only-gh");
  }
  if (GH_WRITE_GROUPS.get(group)?.has(action)) {
    return deny(
      "default-gh-write",
      `gh ${group} ${action} writes through default GitHub CLI authentication.`,
      "Do not use default gh for pushes, pull requests, comments, or other writes; use the directory-specific authorized identity.",
    );
  }
  const readOnlyActions = new Set([
    "checks",
    "diff",
    "download",
    "list",
    "status",
    "view",
    "watch",
  ]);
  if (readOnlyActions.has(action) || (!action && ["status", "version", "help"].includes(group))) {
    return allow("read-only-gh");
  }
  return confirm(
    "unclassified-gh-command",
    `gh ${group} ${action}`.trim() + " is not proven read-only.",
    "Inspect the command and do not execute it if it writes through default gh authentication.",
  );
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

  const executable = tokens[0].split("/").at(-1).toLowerCase();
  if (executable === "git") return evaluateGit(tokens.slice(1));
  if (executable === "gh") return evaluateGh(tokens.slice(1));
  return allow();
}

export function evaluateCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "The shell command is missing or malformed.",
      "Provide the normalized command without credentials.",
    );
  }

  let strongest = allow();
  for (const segment of commandSegments(command)) {
    const value = evaluateSegment(segment);
    if (value.decision === "deny") return value;
    if (value.decision === "confirm") strongest = value;
    else if (strongest.decision === "allow") strongest = value;
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
        "Policy input must contain a normalized shell command.",
        "Provide the tool name and command without credentials.",
      );
    }
    return evaluateCommand(command);
  } catch {
    return deny(
      "policy-evaluation-error",
      "The Git policy could not classify the operation safely.",
      "Stop before mutation and inspect the normalized command manually.",
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
        "The Git policy input exceeds its size limit.",
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
      "The Git policy input is not valid JSON.",
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
