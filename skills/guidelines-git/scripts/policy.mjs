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
        "宽泛暂存会把用户自己的无关改动一并纳入。",
        "检查暂存区，只暂存属于当前这次完整改动的确切路径。",
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
        "amend 或 fixup 提交会改写已有历史。",
        "先检查已暂存的 diff，并就该具体提交取得明确授权。",
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
        "带 pathspec 提交可能绕过或混入已检查的暂存区内容。",
        "授权提交前，先检查确切的 pathspec、工作区 diff 和暂存 diff。",
      );
    }
    if (
      rest.includes("--all") ||
      rest.some((value) => /^-[^-]*a/iu.test(value))
    ) {
      return confirm(
        "broad-staging",
        "git commit --all 会暂存所有已跟踪改动，其中可能有用户自己的改动。",
        "检查暂存区，只暂存属于当前这次完整改动的确切路径或代码块。",
      );
    }
    return allow("normal-commit");
  }
  if (subcommand === "config") {
    if (args.includes("--global") || args.includes("--system")) {
      return deny(
        "global-git-config-write",
        "全局或系统级 Git 配置会改变其他无关仓库的身份和凭据。",
        "先查看仓库内现有配置值，且只修改仓库级配置。",
      );
    }
    return confirm(
      "repository-git-config-write",
      "仓库级 Git 配置会改变身份、传输方式或命令行为。",
      "修改前确认确切的本地配置项和不含密钥的值。",
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
        "默认的 github.com 传输方式无法证明使用的是本目录配置的 SSH 身份。",
        "使用本仓库配置的推送远端和目录专属 SSH 别名；不得回落到 HTTPS、令牌或其他账号。",
      );
    }
    return confirm(
      rest.some((value) => value === "--force" || value === "-f" || value.startsWith("--force-with-lease"))
        ? "force-push"
        : "git-push",
      "推送会改变远端状态，需要针对该操作的明确授权。",
      "推送前确认仓库的推送远端、SSH 别名、目标 ref 和提交范围。",
    );
  }
  if (subcommand === "fetch") {
    if (rest.some((value) => !value.startsWith("-") && value.includes(":"))) {
      return confirm(
        "fetch-local-ref-update",
        "带目标端的 fetch refspec 会更新本地 ref。",
        "fetch 前确认确切的 refspec 和会被影响的本地 ref。",
      );
    }
    return allow("fetch-remote-tracking");
  }
  if (REMOTE_MUTATIONS.has(subcommand)) {
    return confirm(
      "remote-or-worktree-mutation",
      `git ${subcommand} 会改变本地 ref、历史或文件系统状态。`,
      "就确切的远端、ref、目标位置和受影响的工作区取得明确授权。",
    );
  }
  if (HISTORY_OR_BRANCH_MUTATIONS.has(subcommand)) {
    return confirm(
      "history-or-branch-mutation",
      `git ${subcommand} 可能改变分支、历史、暂存区，或用户自己的工作区改动。`,
      "先查看状态和 diff，再就受影响的确切 ref 和路径取得明确授权。",
    );
  }
  if (["branch", "tag", "remote", "worktree", "submodule", "init"].includes(subcommand)) {
    return confirm(
      "repository-structure-mutation",
      `git ${subcommand} 可能改变仓库的 ref、远端、配置或工作区。`,
      "继续前确认这次改动的确切内容和影响范围。",
    );
  }

  return confirm(
    "unclassified-git-command",
    `git ${subcommand} 未被归类为只读操作。`,
    "查阅该命令的官方说明；若会改变仓库或远端状态，则需取得授权。",
  );
}

function evaluateGh(args) {
  const group = (args[0] ?? "").toLowerCase();
  const action = (args[1] ?? "").toLowerCase();

  if (group === "auth") {
    if (action === "status") return allow("read-only-gh");
    return deny(
      action === "setup-git" ? "gh-auth-setup-git" : "gh-auth-mutation",
      "修改 GitHub CLI 认证会替换或绕过本目录的 SSH 身份。",
      "不要修改或复用默认的 gh 认证；使用本仓库配置的 SSH 身份。",
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
        "禁止通过默认 gh 认证进行 GitHub API 写操作。",
        "使用本目录授权的身份，并就该具体写操作取得明确批准。",
      );
    }
    return allow("read-only-gh");
  }
  if (GH_WRITE_GROUPS.get(group)?.has(action)) {
    return deny(
      "default-gh-write",
      `gh ${group} ${action} 会通过默认 GitHub CLI 认证写入。`,
      "不要用默认 gh 做推送、PR、评论等写操作；使用本目录授权的身份。",
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
    `gh ${group} ${action}`.trim() + " 无法确认是只读操作。",
    "检查该命令；若它通过默认 gh 认证写入，则不要执行。",
  );
}

function evaluateSegment(segment) {
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
  if (executable === "git") return evaluateGit(tokens.slice(1));
  if (executable === "gh") return evaluateGh(tokens.slice(1));
  return allow();
}

export function evaluateCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "Shell 命令缺失或格式错误。",
      "提供规范化的命令，不要包含凭据。",
    );
  }

  const segments = commandSegments(command);
  let strongest = allow();
  for (const segment of segments) {
    const value = evaluateSegment(segment);
    if (value.decision === "deny") return withVisibilityHint(value, segments.length);
    if (value.decision === "confirm") strongest = value;
    else if (strongest.decision === "allow") strongest = value;
  }
  return withVisibilityHint(strongest, segments.length);
}

// A gated write chained behind other work is invisible in the approval prompt:
// the user sees the harmless prefix and approves the tail without reading it.
function withVisibilityHint(value, segmentCount) {
  if (segmentCount < 2 || value.decision === "allow") return value;
  return {
    ...value,
    nextAction: `${value.nextAction ?? ""} 请把该操作单独作为一条命令重新发出，不要串在命令链里，好让审批提示准确显示被批准的内容。`.trim(),
  };
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
        "策略输入必须包含规范化的 shell 命令。",
        "提供工具名和命令，不要包含凭据。",
      );
    }
    return evaluateCommand(command);
  } catch {
    return deny(
      "policy-evaluation-error",
      "Git 策略无法安全地判定该操作。",
      "在改动前停下，手动检查规范化后的命令。",
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
        "Git 策略的输入超过大小限制。",
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
      "Git 策略的输入不是合法 JSON。",
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
