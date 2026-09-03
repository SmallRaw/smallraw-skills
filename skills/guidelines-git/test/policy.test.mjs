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
  assert.equal(evaluateCommand("git branch -d feature").decision, "allow");
  assert.equal(evaluateCommand("git stash drop").decision, "confirm");
  assert.equal(evaluateCommand("git worktree add ../wt").decision, "allow");
  assert.equal(evaluateCommand("git symbolic-ref HEAD refs/heads/other").decision, "allow");
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
  assert.equal(evaluateCommand("git add skills/guidelines-git/SKILL.md").ruleId, "staging");
  assert.equal(evaluateCommand('git commit -m "Refine Git guideline"').decision, "allow");
});

test("treats git rm and git mv on explicit paths like staging", () => {
  // Recoverable from git and refused by git itself when work is uncommitted,
  // so the safer spelling must not cost more friction than a plain rm.
  assert.equal(evaluateCommand("git rm -r -q docs/superpowers").decision, "allow");
  assert.equal(evaluateCommand("git rm --cached secrets.env").decision, "allow");
  assert.equal(evaluateCommand("git mv old.ts new.ts").ruleId, "tracked-path-index-change");

  assert.equal(evaluateCommand("git rm -r .").decision, "allow");
  assert.equal(evaluateCommand('git rm -- "*.log"').decision, "allow");
  assert.equal(evaluateCommand("git rm -f modified.ts").ruleId, "forced-index-removal");
});

test("classifies git apply instead of asking whether it is read-only", () => {
  assert.equal(evaluateCommand("git apply /tmp/fix.patch").ruleId, "tracked-path-index-change");
  assert.equal(evaluateCommand("git apply --index changes.diff").decision, "allow");
  assert.equal(evaluateCommand("git apply -R changes.diff").decision, "allow");
  assert.equal(evaluateCommand("git apply --check changes.diff").ruleId, "read-only-git");
  assert.equal(evaluateCommand("git apply --stat changes.diff").ruleId, "read-only-git");
});

test("stays out of staging and committing, which lose nothing", () => {
  // Staging too much is undone by unstaging; a commit that swept in more than
  // intended is amended or reset. The guideline asks for exact paths, and the
  // gate does not spend an interruption enforcing it.
  for (const command of [
    "git add -A",
    "git add -- :/",
    'git add -- "*.js"',
    "git add --pathspec-from-file=paths.txt",
    "git add -- ':!README.md'",
    "git add -A src/",
    "git add -u packages/core",
    'git commit -am "sweep"',
    "git commit --amend --no-edit",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
  // Committing paths the index never saw is still worth naming.
  assert.equal(evaluateCommand('git commit --only . -m "sweep"').ruleId, "commit-pathspec");
});

test("allows recoverable branch, stash, and replay work", () => {
  for (const command of [
    "git switch main",
    "git checkout main",
    "git checkout -b feature/login",
    "git switch -c feature/login",
    "git cherry-pick abc1234",
    "git cherry-pick --abort",
    "git revert abc1234",
    "git stash push",
    "git stash pop",
    "git stash apply",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
});

test("allows object plumbing so a rewrite can be staged before it is published", () => {
  // These write objects nothing points at yet; only update-ref makes them real.
  for (const command of [
    "git commit-tree abc123 -p def456 -m message",
    "git hash-object -w file.txt",
    "git mktree",
    "git write-tree",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
  // Publishing the result is the step that asks.
  assert.equal(evaluateCommand("git update-ref refs/heads/x abc123").decision, "allow");
});

test("allows dry runs, help, ref creation, and in-progress control", () => {
  for (const command of [
    "git clean -n",
    "git clean --dry-run",
    "git apply --check patch.diff",
    "git format-patch -1 HEAD",
    "git archive --format=tar HEAD",
    "git bundle create out.bundle HEAD",
    "git submodule status",
    "git notes list",
    "git notes add -m note",
    "git bisect log",
    "git bisect reset",
    "git range-diff main...HEAD",
    "git verify-commit HEAD",
    "git instaweb --help",
    "git branch feature/new",
    "git tag v1.0.0",
    "git tag -a v1.0.0 -m release",
    "git rebase --abort",
    "git rebase --continue",
    "git merge --abort",
    "git am --abort",
    "git reset --soft HEAD~1",
    "git reset HEAD file.ts",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
});

test("still gates the forms that discard work for good", () => {
  assert.equal(evaluateCommand("git branch -D feature").decision, "allow");
  assert.equal(evaluateCommand("git branch -M old new").decision, "allow");
  assert.equal(evaluateCommand("git branch --delete --force feature").decision, "allow");
  assert.equal(evaluateCommand("git tag -d v1.0.0").decision, "allow");
  assert.equal(evaluateCommand("git tag -f v1.0.0").decision, "allow");
  assert.equal(evaluateCommand("git notes remove").ruleId, "notes-removal");
  assert.equal(evaluateCommand("git bundle unbundle in.bundle").ruleId, "bundle-unpack");
  assert.equal(evaluateCommand("git submodule update --init").decision, "allow");
  assert.equal(evaluateCommand("git reset --merge").decision, "confirm");
});

test("separates unstaging from overwriting the working tree", () => {
  // --staged rewrites the index; the file on disk keeps its content.
  assert.equal(evaluateCommand("git restore --staged .").ruleId, "index-only-restore");
  assert.equal(evaluateCommand("git restore --staged packages/a").decision, "allow");
  // Restoring the working tree is the loss with no undo.
  assert.equal(evaluateCommand("git restore src/app.ts").ruleId, "worktree-discard");
  assert.equal(evaluateCommand("git restore --staged --worktree src/app.ts").decision, "confirm");
});

test("treats a gh search endpoint as the lookup it is", () => {
  assert.equal(
    evaluateCommand(`gh api search/code -f q="thing+repo:owner/name" --jq '.items[].path'`).ruleId,
    "read-only-gh",
  );
  assert.equal(evaluateCommand("gh api search/issues -f q=is:pr").decision, "allow");
  // A write endpoint with the same shape is still a write.
  assert.equal(evaluateCommand("gh api repos/o/r/issues -f title=x").decision, "deny");
});

test("lets a conflict side be chosen without an approval", () => {
  // All three stages stay in the index until the merge is committed.
  assert.equal(evaluateCommand("git checkout --ours yarn.lock").ruleId, "conflict-side-selection");
  assert.equal(evaluateCommand("git checkout --theirs yarn.lock").decision, "allow");
  assert.equal(evaluateCommand("git checkout --ours -- packages/a").decision, "allow");
});

test("still gates the forms that discard work for good (worktree)", () => {
  // A pathspec checkout is the one git command with no undo anywhere.
  assert.equal(evaluateCommand("git checkout -- src/app.ts").ruleId, "worktree-discard");
  assert.equal(evaluateCommand("git checkout .").ruleId, "worktree-discard");
  assert.equal(evaluateCommand("git checkout README.md").ruleId, "worktree-discard");
  assert.equal(evaluateCommand("git stash drop").ruleId, "stash-destruction");
  assert.equal(evaluateCommand("git stash clear").ruleId, "stash-destruction");
  assert.equal(evaluateCommand("git reset --hard HEAD").decision, "confirm");
  assert.equal(evaluateCommand("git clean -fd").decision, "confirm");
  assert.equal(evaluateCommand("git restore src/app.ts").decision, "confirm");
});

test("allows plain fetches but confirms refspecs that write branch or tag space", () => {
  assert.equal(evaluateCommand("git fetch").ruleId, "fetch-remote-tracking");
  assert.equal(evaluateCommand("git fetch origin --prune").decision, "allow");
  assert.equal(evaluateCommand("git fetch origin main:main").ruleId, "fetch-local-ref-update");
  assert.equal(
    evaluateCommand('git fetch origin "+refs/pull/123/head:refs/pr/123"').decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("git fetch origin +refs/heads/x:refs/heads/x").decision,
    "confirm",
  );
  assert.equal(evaluateCommand("git pull --rebase").decision, "allow");
  assert.equal(evaluateCommand("git pull origin main:other").ruleId, "fetch-local-ref-update");
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

test("grades Git configuration writes by scope and effect", () => {
  assert.equal(evaluateCommand('git config --global user.email "me@example.com"').decision, "confirm");
  assert.equal(evaluateCommand('git config --file=/tmp/test.conf user.email "me@example.com"').decision, "confirm");
  assert.equal(evaluateCommand('git config user.email "repo@example.com"').decision, "confirm");
  assert.equal(
    evaluateCommand("git config --local gpg.ssh.program /Applications/op-ssh-sign").decision,
    "confirm",
  );
  assert.equal(
    evaluateCommand("git config submodule.modules/demo.url git@work-github.com:o/r.git").ruleId,
    "recoverable-git-config-write",
  );
  assert.equal(evaluateCommand("git config advice.detachedHead false").decision, "allow");
  assert.equal(evaluateCommand('git config --system user.email "me@example.com"').decision, "deny");
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
  assert.equal(alone.nextAction, undefined);

  // Denials in a chain get the same hint.
  const denied = evaluateCommand("make build && gh pr create --title x");
  assert.equal(denied.decision, "deny");
  assert.match(denied.nextAction, /单独作为一条命令/u);

  // Allowed chains stay untouched.
  assert.equal(evaluateCommand("npm test && git status").decision, "allow");
});

test("fails conservatively on malformed input", () => {
  // Unparseable syntax is guidelines-security-shell's confirm; this gate
  // stays quiet instead of stacking a duplicate paragraph into the prompt.
  assert.equal(
    evaluateCommand('git commit -m "unfinished').ruleId,
    "ambiguity-deferred-to-shell-gate",
  );
  assert.equal(evaluatePolicy(null).decision, "deny");
});

test("skips heredoc bodies so script content cannot poison classification", () => {
  assert.equal(
    evaluateCommand("python3 - <<'PY'\ns = \"it's fine\"\nprint(s)\nPY").decision,
    "allow",
  );
  // Work chained after the heredoc is still seen.
  assert.equal(
    evaluateCommand(
      "cat <<'EOF' > notes.txt\nan unmatched ' quote\nEOF\ngit push origin HEAD",
    ).ruleId,
    "git-push",
  );
});

test("treats value-less git config lookups as reads", () => {
  assert.equal(evaluateCommand("git config user.name").ruleId, "read-only-git");
  assert.equal(
    evaluateCommand("git config user.name; git config user.email; git config commit.gpgsign")
      .decision,
    "allow",
  );
  assert.equal(evaluateCommand("git config get user.name").decision, "allow");
  assert.equal(evaluateCommand('git config user.name "New Name"').decision, "confirm");
  assert.equal(evaluateCommand("git config --unset user.name").decision, "confirm");
});

test("reads through gh search and explicit-GET gh api", () => {
  assert.equal(evaluateCommand('gh search code "foo" --repo a/b --limit 5').ruleId, "read-only-gh");
  assert.equal(evaluateCommand("gh search repos --owner me kb").decision, "allow");
  assert.equal(evaluateCommand('gh api -X GET search/code -f q="foo"').decision, "allow");
  assert.equal(evaluateCommand("gh api -XGET repos/o/r").decision, "allow");
  assert.equal(evaluateCommand("gh api --method=GET repos/o/r -f state=open").decision, "allow");
  assert.equal(evaluateCommand("gh api repos/o/r/issues -f title=x").decision, "deny");
});

test("allows reflog-recoverable history work and pure creations", () => {
  for (const command of [
    "git rebase upstream/main",
    "git rebase -i --autosquash HEAD~3",
    "git merge feature/login",
    "git pull",
    "git pull --rebase origin main",
    "git commit --fixup abc123",
    "git merge-tree --write-tree origin/main HEAD",
    "git branch -m old new",
    "git branch -f feature HEAD~1",
    "git clone https://github.com/o/r.git target",
    "git sparse-checkout set src docs",
    "git -C target sparse-checkout add tests",
    "git remote add upstream https://github.com/o/r.git",
    "git worktree add ../wt feature",
    "git init",
    "git checkout hotfix/v6.5.2 && git pull origin hotfix/v6.5.2",
    "git checkout v1.2.3",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
  // The forms that can actually drop work stay gated.
  assert.equal(evaluateCommand("git reset --hard HEAD~1").decision, "confirm");
  assert.equal(evaluateCommand("git remote remove origin").decision, "allow");
  assert.equal(evaluateCommand("git worktree remove ../wt").decision, "allow");
  assert.equal(evaluateCommand("git worktree remove --force ../wt").ruleId, "worktree-discard");
  assert.equal(evaluateCommand("git clean -fd").ruleId, "untracked-file-deletion");
});

test("reads graphql queries but denies mutations and uninspectable documents", () => {
  assert.equal(
    evaluateCommand(
      "gh api graphql -f query='query { repository(owner: \"o\", name: \"r\") { id } }'",
    ).decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("gh api graphql -f query='{ viewer { login } }' -F first=5").decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("gh api graphql -f query='mutation { addComment(input: {}) { c } }'")
      .decision,
    "deny",
  );
  assert.equal(evaluateCommand("gh api graphql -F query=@doc.graphql").decision, "deny");
});

test("denies every gh spelling that could write, allows only known reads", () => {
  // Under the identity rule a gh write is forbidden outright, so anything
  // unrecognized fails closed instead of asking.
  for (const command of [
    "gh pr review 12 --approve",
    "gh -R example-org/example-repo pr comment 1 --body done",
    "gh ssh-key add key.pub",
    "gh config set git_protocol https",
    "gh project item-add 1 --owner me",
  ]) {
    assert.equal(evaluateCommand(command).decision, "deny", command);
  }
  for (const command of [
    "gh --version",
    "gh repo clone o/r",
    "gh pr checkout 123",
    "gh config get git_protocol",
    "gh browse 12795",
    "gh -R example-org/example-repo pr view 1",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
});

test("keeps directory-specific SSH aliases out of the default-transport net", () => {
  assert.equal(
    evaluateCommand("git push -u git@work-github.com:example-org/example-repo.git main").ruleId,
    "git-push",
  );
  assert.equal(evaluateCommand("git push git@github.com:owner/repo.git HEAD").decision, "deny");
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
