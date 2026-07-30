import assert from "node:assert/strict";
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

test("allows explicit staging and normal commits", () => {
  assert.equal(
    evaluateCommand("git add skills/guidelines-git/SKILL.md").ruleId,
    "explicit-staging",
  );
  assert.equal(evaluateCommand('git commit -m "Refine Git guideline"').decision, "allow");
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
