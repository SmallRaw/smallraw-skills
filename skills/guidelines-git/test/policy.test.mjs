import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateCommand,
  evaluatePolicy,
} from "../scripts/policy.mjs";

const policyScript = fileURLToPath(new URL("../scripts/policy.mjs", import.meta.url));

test("allows read-only Git inspection", () => {
  assert.equal(evaluateCommand("git status --short").ruleId, "read-only-git");
  assert.equal(evaluateCommand("git -C repo diff --cached").decision, "allow");
  assert.equal(evaluateCommand("git branch --show-current").decision, "allow");
  assert.equal(evaluateCommand("git remote -v").decision, "allow");
});

test("allows common read-only inspection forms without confirmation", () => {
  for (const command of [
    "git merge-base --is-ancestor abc123 origin/main",
    "git rev-list --count HEAD",
    "git describe --tags",
    "git check-ignore workspaces/foo",
    "git show-ref --heads",
    "git ls-remote origin main",
    "git diff-tree --no-commit-id --name-only HEAD",
    "git branch -a",
    "git branch -vv",
    "git tag -n9",
    "git stash list",
    "git stash show",
    "git worktree list",
    "git symbolic-ref --short HEAD",
    "git reflog",
    "git cherry -v",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
  assert.equal(evaluateCommand("git branch -d feature").decision, "confirm");
  assert.equal(evaluateCommand("git stash push").decision, "confirm");
  assert.equal(evaluateCommand("git worktree add ../wt").decision, "confirm");
  assert.equal(
    evaluateCommand("git symbolic-ref HEAD refs/heads/other").decision,
    "confirm",
  );
  assert.equal(evaluateCommand("git reflog expire --all").decision, "confirm");
});

test("CLI runs and emits a verdict when invoked through a symlink", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-policy-link-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const link = path.join(root, "policy.mjs");
  fs.symlinkSync(policyScript, link);

  const run = spawnSync(process.execPath, [link], {
    input: JSON.stringify({ kind: "command", target: "gh auth setup-git" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).decision, "deny");
});

test("allows explicit staging and normal commits", () => {
  assert.equal(
    evaluateCommand("git add skills/guidelines-git/SKILL.md").ruleId,
    "explicit-staging",
  );
  assert.equal(evaluateCommand('git commit -m "Refine Git guideline"').decision, "allow");
});

test("treats git rm and git mv on explicit paths like staging", () => {
  // Recoverable from git and refused by git itself when work is uncommitted,
  // so the safer spelling must not cost more friction than a plain rm.
  assert.equal(evaluateCommand("git rm -r -q docs/superpowers").decision, "allow");
  assert.equal(evaluateCommand("git rm --cached secrets.env").decision, "allow");
  assert.equal(evaluateCommand("git mv old.ts new.ts").ruleId, "tracked-path-index-change");

  assert.equal(evaluateCommand("git rm -r .").ruleId, "broad-staging");
  assert.equal(evaluateCommand('git rm -- "*.log"').ruleId, "broad-staging");
  assert.equal(evaluateCommand("git rm -f modified.ts").ruleId, "forced-index-removal");
});

test("requires confirmation for broad staging and commit rewrites", () => {
  assert.equal(evaluateCommand("git add -A").ruleId, "broad-staging");
  assert.equal(evaluateCommand("git add -- :/").ruleId, "broad-staging");
  assert.equal(evaluateCommand('git add -- "*.js"').ruleId, "broad-staging");
  assert.equal(
    evaluateCommand("git add --pathspec-from-file=paths.txt").ruleId,
    "broad-staging",
  );
  assert.equal(
    evaluateCommand("git add --pathspec-from-file paths.txt").ruleId,
    "broad-staging",
  );
  assert.equal(evaluateCommand("git add -- ':!README.md'").ruleId, "broad-staging");
  assert.equal(evaluateCommand("git add -- ':^README.md'").ruleId, "broad-staging");
  assert.equal(evaluateCommand('git commit -am "sweep"').ruleId, "broad-staging");
  assert.equal(evaluateCommand('git commit --only . -m "sweep"').ruleId, "commit-pathspec");
  assert.equal(
    evaluateCommand('git commit --pathspec-from-file=paths.txt -m "sweep"').ruleId,
    "commit-pathspec",
  );
  assert.equal(evaluateCommand("git commit --amend --no-edit").ruleId, "history-rewrite");
});

test("requires confirmation for branch, history, and destructive convenience mutations", () => {
  assert.equal(evaluateCommand("git switch main").decision, "confirm");
  assert.equal(evaluateCommand("git reset --hard HEAD").decision, "confirm");
  assert.equal(evaluateCommand("git stash push").decision, "confirm");
  assert.equal(evaluateCommand("git clean -fd").decision, "confirm");
});

test("allows plain fetches but confirms local-ref-updating refspecs and pulls", () => {
  assert.equal(evaluateCommand("git fetch").ruleId, "fetch-remote-tracking");
  assert.equal(evaluateCommand("git fetch origin --prune").decision, "allow");
  assert.equal(evaluateCommand("git fetch origin main:main").ruleId, "fetch-local-ref-update");
  assert.equal(evaluateCommand("git pull --rebase").decision, "confirm");
});

test("requires confirmation for pushes and blocks default github.com transport", () => {
  assert.equal(evaluateCommand("git push origin HEAD").ruleId, "git-push");
  assert.equal(evaluateCommand("git push --force-with-lease origin HEAD").ruleId, "force-push");
  assert.equal(evaluateCommand("git push git@github.com:owner/repo.git HEAD").decision, "deny");
  assert.equal(
    evaluateCommand("git push ssh://git@github.com/owner/repo.git HEAD").decision,
    "deny",
  );
  assert.equal(evaluateCommand("git push https://github.com/owner/repo.git HEAD").decision, "deny");
});

test("blocks default gh authentication and write actions", () => {
  assert.equal(evaluateCommand("gh auth setup-git").decision, "deny");
  assert.equal(evaluateCommand('gh pr comment 12 --body "done"').decision, "deny");
  assert.equal(evaluateCommand("gh issue create --title bug").decision, "deny");
  assert.equal(evaluateCommand("gh pr view 12").decision, "allow");
  assert.equal(evaluateCommand("gh auth status").decision, "allow");
  assert.equal(evaluateCommand("gh api repos/o/r/issues -X POST").decision, "deny");
  assert.equal(
    evaluateCommand("gh api --raw-field=title=x repos/o/r/issues").decision,
    "deny",
  );
});

test("denies global Git configuration writes", () => {
  assert.equal(evaluateCommand('git config --global user.email "me@example.com"').decision, "deny");
  assert.equal(evaluateCommand('git config user.email "repo@example.com"').decision, "confirm");
});

test("finds Git mutations in shell chains and normalized hook payloads", () => {
  assert.equal(evaluateCommand("cd repo && git push origin HEAD").decision, "confirm");
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "git checkout -- README.md" },
    }).decision,
    "confirm",
  );
  assert.equal(evaluatePolicy({ tool_name: "Read", tool_input: { path: "README.md" } }).decision, "allow");
});

test("tells the agent to unchain a gated write hidden in a command chain", () => {
  const chained = evaluateCommand("npm test && git commit -m x && git push origin HEAD");
  assert.equal(chained.decision, "confirm");
  assert.match(chained.nextAction, /单独作为一条命令/u);

  // A standalone gated write is already visible; no extra nagging.
  const alone = evaluateCommand("git push origin HEAD");
  assert.equal(alone.decision, "confirm");
  assert.doesNotMatch(alone.nextAction, /单独作为一条命令/u);

  // Denials in a chain get the same hint.
  const denied = evaluateCommand("make build && gh pr create --title x");
  assert.equal(denied.decision, "deny");
  assert.match(denied.nextAction, /单独作为一条命令/u);

  // Allowed chains stay untouched.
  assert.equal(evaluateCommand("npm test && git status").decision, "allow");
});

test("fails conservatively on malformed input", () => {
  assert.equal(evaluateCommand('git commit -m "unfinished').decision, "confirm");
  assert.equal(evaluatePolicy(null).decision, "deny");
});

test("CLI maps allow, confirm, and deny to stable exit codes", () => {
  const cases = [
    ["git status --short", 0, "read-only-git"],
    ["git push origin HEAD", 1, "git-push"],
    ["gh auth setup-git", 2, "gh-auth-setup-git"],
  ];
  for (const [command, status, ruleId] of cases) {
    const run = spawnSync(process.execPath, [policyScript], {
      input: JSON.stringify({ kind: "command", target: command }),
      encoding: "utf8",
    });
    assert.equal(run.status, status);
    assert.equal(JSON.parse(run.stdout).ruleId, ruleId);
  }
});
