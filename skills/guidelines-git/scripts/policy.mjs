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
  // Object plumbing writes into .git/objects without making anything reachable;
  // an unreferenced object is inert and eventually collected. Preparing a
  // rewritten history this way is safe — only the update-ref that publishes it
  // changes what the repository points at.
  "commit-tree",
  "hash-object",
  "merge-tree",
  "mktree",
  "write-tree",
  "pack-objects",
  "unpack-objects",
  "format-patch",
  "archive",
  "verify-commit",
  "verify-tag",
  "range-diff",
  "whatchanged",
]);
// Resuming or abandoning an in-progress operation restores the state it began
// from; it is the way out of trouble, not a way into it.
const IN_PROGRESS_CONTROL = new Set(["--abort", "--continue", "--skip", "--quit", "--edit-todo"]);
// Only these reset modes touch the working tree; the rest move HEAD and leave
// the changes on disk, recoverable through the reflog.
const WORKTREE_RESET_MODES = new Set(["--hard", "--merge", "--keep"]);
const HISTORY_OR_BRANCH_MUTATIONS = new Set([
  "checkout",
  "switch",
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

// For branches, -d refuses unmerged work, renames and moves keep their reflog,
// and a forced pointer move leaves the old tip one reflog lookup away; only
// the force-capital forms clobber an existing branch and drop its reflog with
// it. Tags have no reflog, so a deleted or force-moved tag pointer is gone.
const DESTRUCTIVE_REF_FLAGS = {
  branch: ["-D", "-M", "-C"],
  tag: ["-d", "--delete", "-f", "--force"],
};

function hasDestructiveRefFlag(subcommand, args) {
  const flags = DESTRUCTIVE_REF_FLAGS[subcommand] ?? [];
  if (args.some((value) => flags.includes(value))) return true;
  return subcommand === "branch" && args.includes("--delete") && args.includes("--force");
}

function isReadOnlyRemote(args) {
  return (
    args.length === 0 ||
    args.every((value) => ["-v", "--verbose"].includes(value)) ||
    ["get-url", "show"].includes(args[0])
  );
}

function isReadOnlyConfig(args) {
  if (
    args.some((value) =>
      ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin", "--show-scope"].includes(value),
    )
  ) {
    return true;
  }
  if (
    args.some((value) =>
      [
        "--unset",
        "--unset-all",
        "--replace-all",
        "--add",
        "--remove-section",
        "--rename-section",
        "--edit",
        "-e",
      ].includes(value),
    )
  ) {
    return false;
  }
  // `git config user.name` with no value prints the key; a second positional
  // (the value) or an editing flag is what writes.
  const positionals = args.filter((value) => !value.startsWith("-"));
  if (["get", "list"].includes(positionals[0])) return true;
  return positionals.length <= 1;
}

function isBroadStageToken(value) {
  return (
    [".", "./", ":", ":/", "--pathspec-from-file"].includes(value) ||
    value.startsWith("--pathspec-from-file=") ||
    value.startsWith(":(") ||
    value.startsWith(":!") ||
    value.startsWith(":^") ||
    /[*?[]/u.test(value)
  );
}

// -A/-u sweep the whole tree only when no pathspec narrows them; with an
// explicit path, `git add -A src/` stages exactly what `git add src/` would.
const SWEEP_STAGE_FLAGS = new Set(["-A", "--all", "-u", "--update"]);

// A bare name is read as a branch; `.` and anything with a file extension is
// read as a path, which is the form that discards work. An all-digit suffix
// is a version number (hotfix/v6.5.2), not an extension.
function isDiscardingPathspec(value) {
  if (value.startsWith("-")) return false;
  return (
    value === "." ||
    value === "./" ||
    value.startsWith("./") ||
    /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/u.test(value)
  );
}

function evaluateGit(args) {
  const parsed = gitSubcommand(args);
  const subcommand = parsed.subcommand;
  const rest = parsed.args;

  if (!subcommand || READ_ONLY_GIT_COMMANDS.has(subcommand)) {
    return allow("read-only-git");
  }
  // Asking a command to explain itself, or to say what it would do, changes nothing.
  if (rest.includes("--help") || rest.includes("--dry-run")) return allow("read-only-git");
  if (subcommand === "clean" && (rest.includes("-n") || rest.includes("--dry-run"))) {
    return allow("read-only-git");
  }
  if (
    subcommand === "apply" &&
    rest.some((value) => ["--check", "--stat", "--summary", "--numstat"].includes(value))
  ) {
    return allow("read-only-git");
  }
  if (rest.some((value) => IN_PROGRESS_CONTROL.has(value))) {
    return allow("in-progress-control");
  }

  if (subcommand === "branch" && isReadOnlyBranch(rest)) return allow("read-only-git");
  if (subcommand === "tag" && isReadOnlyTag(rest)) return allow("read-only-git");
  // Adding a ref or a note takes nothing away; removing or renaming one does.
  if (subcommand === "branch" && !hasDestructiveRefFlag("branch", rest)) return allow("ref-creation");
  if (subcommand === "tag" && !hasDestructiveRefFlag("tag", rest)) return allow("ref-creation");
  if (subcommand === "notes") {
    const verb = rest.find((value) => !value.startsWith("-")) ?? "";
    if (["remove", "prune"].includes(verb)) {
      return confirm("notes-removal", "会删除已有的 git 注记。");
    }
    return allow("notes-write");
  }
  // Bisect only moves HEAD around existing commits, and reset returns to the start.
  if (subcommand === "bisect") return allow("bisect-navigation");
  if (subcommand === "bundle") {
    if ((rest[0] ?? "") === "unbundle") {
      return confirm("bundle-unpack", "会把外部 bundle 的 ref 写进本仓库。", "确认来源可信。");
    }
    return allow("read-only-git");
  }
  if (subcommand === "submodule" && ["status", "summary"].includes(rest[0] ?? "")) {
    return allow("read-only-git");
  }
  if (subcommand === "reset" && !rest.some((value) => WORKTREE_RESET_MODES.has(value))) {
    return allow("index-only-reset");
  }
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
    const hasPathspec = rest.some((value) => !value.startsWith("-"));
    if (
      rest.some(isBroadStageToken) ||
      (!hasPathspec && rest.some((value) => SWEEP_STAGE_FLAGS.has(value)))
    ) {
      return confirm(
        "broad-staging",
        "会把你未提交的其他改动一并暂存进来。",
        "只暂存本次改动的路径。",
      );
    }
    return allow("explicit-staging");
  }
  // Index operations on tracked paths: the content stays recoverable from git,
  // and git itself refuses to drop uncommitted work unless forced. Treat them
  // like staging — broad pathspecs and --force are what need a look.
  if (subcommand === "rm" || subcommand === "mv") {
    if (rest.some(isBroadStageToken)) {
      return confirm(
        "broad-staging",
        `git ${subcommand} 的宽泛 pathspec 会波及无关文件。`,
        "写明确切路径。",
      );
    }
    if (rest.some((value) => value === "-f" || value === "--force")) {
      return confirm(
        "forced-index-removal",
        `会丢弃这些路径未提交的改动。`,
      );
    }
    return allow("tracked-path-index-change");
  }
  if (subcommand === "commit") {
    // Amend and fixup take nothing away: the previous commit stays in the
    // reflog, and a rewritten history still has to pass the push gate.
    if (
      rest.some((value) =>
        ["--only", "-o", "--include", "-i", "--pathspec-from-file"].includes(value) ||
        value.startsWith("--pathspec-from-file="),
      )
    ) {
      return confirm(
        "commit-pathspec",
        "可能提交暂存区之外的内容。",
      );
    }
    if (
      rest.includes("--all") ||
      rest.some((value) => /^-[^-]*a/iu.test(value))
    ) {
      return confirm(
        "broad-staging",
        "会把你所有未暂存的改动一并提交。",
      );
    }
    return allow("normal-commit");
  }
  if (subcommand === "config") {
    if (args.includes("--global") || args.includes("--system")) {
      return deny(
        "global-git-config-write",
        "会修改全局 Git 配置，影响其他仓库。",
        "只改仓库级配置。",
      );
    }
    return confirm(
      "repository-git-config-write",
      "会修改本仓库的 git 配置。",
    );
  }
  if (subcommand === "push") {
    const joined = rest.join(" ");
    // The lookbehind keeps directory-specific SSH aliases that merely end in
    // "github.com" (byte-github.com:owner/repo) out of the default-transport net.
    if (
      /(?:https?:\/\/github\.com(?:\/|$)|ssh:\/\/(?:git@)?github\.com(?:\/|$)|(?<![\w.-])(?:git@)?github\.com:)/iu.test(
        joined,
      )
    ) {
      return deny(
        "default-github-transport",
        "直接推 github.com 无法保证用的是本目录的 SSH 身份。",
        "先 git remote set-url 配好目录专属 SSH 别名，再推配置好的远端。",
      );
    }
    const forced = rest.some(
      (value) => value === "--force" || value === "-f" || value.startsWith("--force-with-lease"),
    );
    return confirm(
      forced ? "force-push" : "git-push",
      forced ? "会强制覆盖远端已有的提交历史。" : "会把本地提交发布到远端仓库。",
    );
  }
  if (subcommand === "fetch") {
    // A destination outside branch and tag space (refs/pr/*, refs/remotes/*)
    // can clobber nothing anyone works on; only writes into refs/heads/ or
    // refs/tags/ need a look.
    const touchesLocalRefs = rest.some((value) => {
      if (value.startsWith("-") || !value.includes(":")) return false;
      const destination = value.split(":").pop();
      return (
        !destination.startsWith("refs/") ||
        destination.startsWith("refs/heads/") ||
        destination.startsWith("refs/tags/")
      );
    });
    if (touchesLocalRefs) {
      return confirm(
        "fetch-local-ref-update",
        "会改写本地分支或标签指针。",
      );
    }
    return allow("fetch-remote-tracking");
  }
  // Moving between branches is recoverable and git refuses to clobber uncommitted
  // work. A pathspec checkout is the exception: it discards those changes with no
  // undo anywhere, so it stays gated even though its branch sibling does not.
  if (subcommand === "checkout" || subcommand === "switch") {
    if (rest.includes("--") || rest.some(isDiscardingPathspec)) {
      return confirm(
        "worktree-discard",
        `会丢弃这些文件未提交的修改，无法恢复。`,
        "要保留就先 stash。",
      );
    }
    return allow("branch-move");
  }
  // Applies a commit onto the current branch; git refuses on a dirty worktree,
  // the result is a new commit, and --abort or the reflog undoes it.
  if (subcommand === "cherry-pick" || subcommand === "revert") {
    return allow("recoverable-commit-application");
  }
  if (subcommand === "stash") {
    if (["drop", "clear"].includes(rest[0] ?? "")) {
      return confirm(
        "stash-destruction",
        `会删除 stash 里保存的改动，基本找不回。`,
      );
    }
    return allow("recoverable-stash");
  }
  // Merge and rebase refuse to clobber uncommitted work, and every commit
  // they move or rewrite stays reachable from the reflog; publishing the
  // rewritten result is what the push gate watches.
  if (subcommand === "merge" || subcommand === "rebase") {
    return allow("reflog-recoverable-history");
  }
  // Pull is fetch plus a merge into the current branch — same recoverability;
  // a refspec with a destination is the exception, handled like fetch.
  if (subcommand === "pull") {
    if (rest.some((value) => !value.startsWith("-") && value.includes(":"))) {
      return confirm(
        "fetch-local-ref-update",
        "会改写本地分支或标签指针。",
      );
    }
    return allow("reflog-recoverable-history");
  }
  // Creations take nothing away: clone refuses a non-empty target, and a new
  // remote, worktree, or repository only adds state.
  if (subcommand === "clone") return allow("worktree-creation");
  if (subcommand === "remote" && rest[0] === "add") return allow("ref-creation");
  if (subcommand === "worktree" && rest[0] === "add") return allow("worktree-creation");
  if (subcommand === "init") return allow("worktree-creation");
  if (HISTORY_OR_BRANCH_MUTATIONS.has(subcommand)) {
    return confirm(
      "history-or-branch-mutation",
      `git ${subcommand} 可能丢弃未提交的改动。`,
    );
  }
  if (["branch", "tag", "remote", "worktree", "submodule", "init"].includes(subcommand)) {
    return confirm(
      "repository-structure-mutation",
      `git ${subcommand} 会删改分支、标签、远端或工作树。`,
    );
  }

  return confirm(
    "unclassified-git-command",
    `不确定 git ${subcommand} 是否只读。`,
    "确认它不改仓库状态。",
  );
}

function evaluateGh(rawArgs) {
  // Strip leading global flags so a write spelled `gh -R o/r pr comment`
  // cannot hide the group behind the flag; unknown flags fail toward deny.
  const args = [...rawArgs];
  while (args.length > 0 && args[0].startsWith("-")) {
    const flag = args[0].toLowerCase();
    if (["--version", "--help", "-h"].includes(flag)) return allow("read-only-gh");
    const takesValue = ["-r", "--repo", "--hostname"].includes(flag) && !flag.includes("=");
    args.splice(0, takesValue ? 2 : 1);
  }
  const group = (args[0] ?? "").toLowerCase();
  const action = (args[1] ?? "").toLowerCase();

  if (group === "auth") {
    if (action === "status") return allow("read-only-gh");
    return deny(
      action === "setup-git" ? "gh-auth-setup-git" : "gh-auth-mutation",
      "会改动 gh 认证，绕过本目录的 SSH 身份。",
      "用本仓库配置的 SSH 身份。",
    );
  }
  if (group === "api") {
    const methodIndex = args.findIndex((value) => value === "--method" || value === "-X");
    const inlineMethod = args.find((value) => /^(?:--method=|-X).+/u.test(value));
    const explicitMethod = (
      methodIndex >= 0
        ? String(args[methodIndex + 1] ?? "")
        : inlineMethod
          ? inlineMethod.replace(/^(?:--method=|-X)/u, "")
          : ""
    ).toUpperCase();
    // gh api -X GET folds -f/-F fields into the query string; an explicit GET
    // reads, whatever else is on the line.
    if (explicitMethod === "GET") return allow("read-only-gh");
    // GraphQL rides on POST even for pure reads: a query document with no
    // mutation is a read. Anything uninspectable (@file, no query field)
    // falls through toward deny.
    if (args[1] === "graphql" && explicitMethod === "") {
      const fieldValues = [];
      for (let index = 2; index < args.length; index += 1) {
        if (/^(?:-f|-F|--field|--raw-field)$/u.test(args[index])) {
          fieldValues.push(args[index + 1] ?? "");
        } else if (args[index].startsWith("-")) {
          const inline = args[index].match(/^(?:--field=|--raw-field=|-f|-F)(.+)$/u);
          if (inline) fieldValues.push(inline[1]);
        }
      }
      const queries = fieldValues
        .filter((value) => value.startsWith("query="))
        .map((value) => value.slice("query=".length));
      if (
        queries.length > 0 &&
        queries.every(
          (value) => /^\s*(?:query\b|\{)/u.test(value) && !/\bmutation\b/iu.test(value),
        )
      ) {
        return allow("read-only-gh");
      }
    }
    const writeFlag =
      explicitMethod !== "" ||
      args.includes("--input") ||
      args.includes("--raw-field") ||
      args.includes("-f") ||
      args.includes("-F") ||
      args.some((value) => /^(?:--input=|--raw-field=|--field=|-f.+|-F.+)/u.test(value));
    if (writeFlag) {
      return deny(
        "default-gh-write",
        "会用默认 gh 账号写 GitHub。",
        "不要用默认 gh 写入。",
      );
    }
    return allow("read-only-gh");
  }
  // Every gh search subcommand queries; none writes.
  if (group === "search") return allow("read-only-gh");
  if (GH_WRITE_GROUPS.get(group)?.has(action)) {
    return deny(
      "default-gh-write",
      `gh ${group} ${action} 会用默认 gh 账号写 GitHub。`,
      "不要用默认 gh 写入。",
    );
  }
  // checkout and clone only write local branches or directories, which git
  // itself keeps recoverable; everything else here reads.
  const readOnlyActions = new Set([
    "checks",
    "checkout",
    "clone",
    "diff",
    "download",
    "get",
    "list",
    "status",
    "verify",
    "view",
    "watch",
  ]);
  if (readOnlyActions.has(action) || (!action && ["status", "version", "help"].includes(group))) {
    return allow("read-only-gh");
  }
  if (["browse", "completion", "help", "version"].includes(group)) {
    return allow("read-only-gh");
  }
  // Anything unrecognized may write GitHub, and under the identity rule a gh
  // write is forbidden outright — asking would imply approval could allow it.
  return deny(
    "unclassified-gh-command",
    "不确定 " + `gh ${group} ${action}`.trim() + " 是否只读；用默认 gh 写 GitHub 一律禁止。",
    "只用已知只读的 gh 子命令；需要写入就报告并停下。",
  );
}

function evaluateSegment(segment) {
  const rawTokens = tokenize(segment);
  if (!rawTokens) {
    // Unparseable syntax is one problem, not three: guidelines-security-shell
    // owns the ambiguity confirm, and the gates install together, so this gate
    // stays quiet instead of stacking the same paragraph into the prompt.
    return allow("ambiguity-deferred-to-shell-gate");
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

  const segments = commandSegments(stripHeredocBodies(command));
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
    nextAction: `${value.nextAction ?? ""} 请把这一步单独作为一条命令重发，不要串在链里。`.trim(),
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
