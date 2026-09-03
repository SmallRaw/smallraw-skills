import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The guideline files tell the agent which spellings need no approval. That is
// a promise the policies have to keep: a guideline that names a safe form which
// then gets gated teaches the agent to ignore the guideline, and one that names
// a gated form as safe teaches it to expect the gate to be broken. Both drift
// silently when a policy is retuned, so every concrete claim is asserted here.

const skills = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const load = async (name) =>
  (await import(path.join(skills, name, "scripts/policy.mjs"))).evaluatePolicy;

const gate = {
  shell: await load("guidelines-security-shell"),
  git: await load("guidelines-git"),
  npm: await load("guidelines-security-npm"),
  local: await load("guidelines-security-local"),
};

const cwd = process.cwd();
const decide = async (which, command) =>
  (await gate[which]({ tool_name: "Bash", tool_input: { command }, cwd })).decision;

test("guidelines-security-shell: the spellings it calls free are free", async () => {
  for (const command of [
    "rm -rf node_modules dist",
    "/usr/bin/trash -- /tmp/scratch-dir",
    "/usr/bin/trash -- ../other-repo/old-build",
    "pkill -f run_server.py",
    'pkill -f "vite --port 6399"',
    "pkill -f Headless",
    "pkill -9 -f 'Chrome for Testing'",
    "docker rm -f smoke-test",
    "docker rmi smoke-image",
    "docker image prune -f",
    "dd if=disk.img | hexdump -C",
    "dd if=/dev/zero of=out.img bs=1m count=4",
    "chmod +x scripts/run.sh",
  ]) {
    assert.equal(await decide("shell", command), "allow", command);
  }
});

test("guidelines-security-shell: the lines it draws are still drawn", async () => {
  for (const command of [
    "pkill -f node",
    "pkill -f chrome",
    "docker volume rm pgdata",
    "docker system prune -a",
    "chmod -R 777 /Users/someone/tree",
  ]) {
    assert.equal(await decide("shell", command), "confirm", command);
  }
  for (const command of [
    "cd ../other-repo && rm -rf build",
    "rm -rf /tmp/scratch-dir",
    "rm -rf build/*",
    "find . -name '*.tmp' -delete",
  ]) {
    assert.equal(await decide("shell", command), "deny", command);
  }
});

test("guidelines-git: ordinary work passes and the one unrecoverable loss does not", async () => {
  for (const command of [
    "git apply /tmp/fix.patch",
    "git apply --3way /tmp/fix.patch",
    "git checkout --ours yarn.lock",
    "git checkout --theirs yarn.lock",
    "git switch feature/x",
    "git rebase origin/main",
    "git commit --amend --no-edit",
  ]) {
    assert.equal(await decide("git", command), "allow", command);
  }
  assert.equal(await decide("git", "git checkout -- src/app.ts"), "confirm");
});

test("guidelines-security-npm: restoring a lockfile is free, re-resolving is not", async () => {
  for (const command of [
    "npm ci --ignore-scripts",
    "yarn install --immutable --ignore-scripts",
    "yarn install --frozen-lockfile --ignore-scripts",
    "npm pack --ignore-scripts @scope/pkg@1.0.0",
  ]) {
    assert.equal(await decide("npm", command), "allow", command);
  }
  assert.equal(await decide("npm", "yarn install --ignore-scripts"), "confirm");
  assert.equal(await decide("npm", "yarn install"), "deny");
});

test("guidelines-security-local: an auth store matches anywhere, a filename where it stands", async () => {
  assert.equal(await decide("local", "cat .env"), "deny");
  assert.equal(await decide("local", 'echo "docs mention ~/.aws/ here"'), "deny");
  assert.equal(await decide("local", 'echo "never touch .env"'), "allow");
});
