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

test("allows routine scripts without forcing a rescan", () => {
  assert.equal(evaluateCommand("npm test").ruleId, "routine-package-manager-command");
  assert.equal(evaluateCommand("pnpm run lint").decision, "allow");
  assert.equal(evaluateCommand("yarn build").decision, "allow");
  assert.equal(evaluateCommand("bun run test").decision, "allow");
  assert.equal(evaluateCommand("npm cache clean --force").decision, "allow");
  for (const command of [
    "npm --version",
    "pnpm -v",
    "yarn --version",
    "bun --help",
    "corepack yarn install --help",
    "/Users/example/.local/bin/corepack pnpm --version",
  ]) {
    assert.equal(evaluateCommand(command).decision, "allow", command);
  }
});

test("CLI runs and emits a verdict when invoked through a symlink", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npm-policy-link-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const link = path.join(root, "policy.mjs");
  fs.symlinkSync(policyScript, link);

  const run = spawnSync(process.execPath, [link], {
    input: JSON.stringify({ kind: "command", target: "npx cowsay hi" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ruleId, "one-off-package-runner");
});

test("blocks dependency graph changes across supported package managers", () => {
  assert.equal(evaluateCommand("npm install lodash").decision, "deny");
  assert.equal(evaluateCommand("npm add lodash").decision, "deny");
  assert.equal(evaluateCommand("npm it").decision, "deny");
  assert.equal(evaluateCommand("pnpm add lodash").decision, "deny");
  assert.equal(evaluateCommand("yarn up lodash").decision, "deny");
  assert.equal(evaluateCommand("bun update").decision, "deny");
});

test("blocks one-off package runners", () => {
  assert.equal(evaluateCommand("npx cowsay hello").decision, "deny");
  assert.equal(evaluateCommand("npm exec -- cowsay hello").decision, "deny");
  assert.equal(evaluateCommand("pnpm dlx cowsay hello").decision, "deny");
  assert.equal(evaluateCommand("yarn dlx cowsay hello").decision, "deny");
  assert.equal(evaluateCommand("bunx cowsay hello").decision, "deny");
  assert.equal(evaluateCommand("pnpm create vite app").decision, "deny");
  assert.equal(evaluateCommand("npm init vite app").decision, "deny");
});

test("runs an already installed binary through npx without asking", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npx-local-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", ".bin", "tsc"), "");

  const run = (command, cwd = root) =>
    evaluatePolicy({ tool_name: "Bash", tool_input: { command }, cwd });

  // Nothing is fetched: this is node_modules/.bin/tsc spelled differently.
  assert.equal(run("npx tsc --noEmit").ruleId, "installed-binary-runner");
  // Resolution walks up, the way npx itself does.
  assert.equal(
    run("npx tsc -p tsconfig.json", path.join(root, "packages", "app")).decision,
    "allow",
  );

  // `cd repo && npx tsc` must read the same as running it from repo; judging it
  // against the session's directory made the identical command deny instead.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "npx-elsewhere-"));
  context.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  assert.equal(run(`cd ${root} && npx tsc --noEmit`, elsewhere).decision, "allow");
  assert.equal(run(`cd ${root}; npx tsc -p tsconfig.json`, elsewhere).decision, "allow");
  assert.equal(run(`cd ${elsewhere} && npx tsc`, root).ruleId, "one-off-package-runner");

  // Anything that would actually reach the registry still stops.
  assert.equal(run("npx cowsay hello").ruleId, "one-off-package-runner");
  assert.equal(run("npx tsc@5.0.0 --noEmit").ruleId, "one-off-package-runner");
  assert.equal(run("npx --package=evil tsc").ruleId, "one-off-package-runner");
  assert.equal(run("npx -y create-app").ruleId, "one-off-package-runner");
});

test("confirms cache-only npx runs but blocks flags that still download", () => {
  const offline = evaluateCommand("npx --offline prettier --check .");
  assert.equal(offline.decision, "confirm");
  assert.equal(offline.ruleId, "cache-only-package-runner");
  assert.equal(evaluateCommand("npx --no-install prettier --check .").decision, "deny");
  assert.equal(evaluateCommand("npx prettier --offline").decision, "deny");
});

test("confirms scripts-disabled installs while blocking script-enabled ones", () => {
  // A plain install still resolves package.json, so it can land a version the
  // committed lockfile never named.
  const result = evaluateCommand("yarn install --ignore-scripts");
  assert.equal(result.decision, "confirm");
  assert.equal(result.ruleId, "scripts-disabled-install");
  assert.equal(evaluateCommand("pnpm install --ignore-scripts").decision, "confirm");
  assert.equal(evaluateCommand("npm ci").decision, "deny");
  assert.equal(evaluateCommand("npm install --immutable").decision, "deny");
});

test("allows an install that provably cannot change the dependency graph", () => {
  for (const command of [
    "npm ci --ignore-scripts",
    "yarn install --immutable --ignore-scripts",
    "yarn install --frozen-lockfile --ignore-scripts",
    "pnpm install --frozen-lockfile --ignore-scripts",
    "YARN_ENABLE_SCRIPTS=false yarn install --immutable",
    "NPM_CONFIG_IGNORE_SCRIPTS=true npm ci",
    "env PNPM_CONFIG_IGNORE_SCRIPTS=1 pnpm install --frozen-lockfile",
  ]) {
    assert.equal(evaluateCommand(command).ruleId, "lockfile-immutable-install", command);
  }
  // Immutability that is switched back off is not immutability.
  assert.equal(
    evaluateCommand("yarn install --immutable --no-immutable --ignore-scripts").ruleId,
    "scripts-disabled-install",
  );
  // Resolving into the lockfile is the thing being guarded, immutable or not.
  assert.equal(
    evaluateCommand("npm install --package-lock-only --ignore-scripts").ruleId,
    "isolated-lockfile-resolution",
  );
  assert.equal(
    evaluateCommand("YARN_ENABLE_SCRIPTS=false yarn install").ruleId,
    "scripts-disabled-install",
  );
});

test("lets a runner report on itself without naming a package", () => {
  for (const command of ["npx --version", "npx -v", "npx --help", "bunx --help"]) {
    assert.equal(evaluateCommand(command).ruleId, "runner-self-report", command);
  }
  // Naming a package to fetch is still refused.
  assert.equal(evaluateCommand("npx cowsay@1.5.0 hi").decision, "deny");
});

test("lets a package be downloaded for review without an approval", () => {
  assert.equal(
    evaluateCommand("npm pack --ignore-scripts @scope/pkg@1.0.0").ruleId,
    "artifact-acquisition-for-review",
  );
  // Fetching with scripts live is still refused.
  assert.equal(evaluateCommand("npm pack @scope/pkg@1.0.0").decision, "deny");
});

test("gates corepack acquisition and versioned manager invocations", () => {
  assert.equal(evaluateCommand("corepack use pnpm@9.1.0").ruleId, "package-manager-acquisition");
  assert.equal(evaluateCommand("corepack install -g yarn@4.1.0").decision, "deny");
  assert.equal(evaluateCommand("corepack enable").decision, "confirm");
  assert.equal(evaluateCommand("corepack --version").decision, "allow");
  assert.equal(evaluateCommand("corepack pnpm@8.6.0 add lodash").decision, "deny");
  assert.equal(evaluateCommand("pnpm@8.6.0 add lodash").decision, "deny");
});

test("finds guarded commands inside ordinary shell chains", () => {
  assert.equal(evaluateCommand("cd app && npm ci").decision, "deny");
  assert.equal(evaluateCommand("echo ready; corepack pnpm install").decision, "deny");
});

test("requires confirmation for isolated lockfile-only resolution", () => {
  const result = evaluateCommand(
    "npm install --package-lock-only --ignore-scripts --save-exact left-pad@1.3.0",
  );
  assert.equal(result.decision, "confirm");
  assert.equal(result.ruleId, "isolated-lockfile-resolution");
});

test("blocks automatic audit fixes", () => {
  assert.equal(evaluateCommand("npm audit fix --force").decision, "deny");
  assert.equal(evaluateCommand("npm rebuild sharp").decision, "deny");
  assert.equal(evaluateCommand("pnpm approve-builds").decision, "deny");
});

test("requires exact approval for registry writes and config changes", () => {
  assert.equal(evaluateCommand("npm publish").decision, "confirm");
  assert.equal(evaluateCommand("yarn npm publish").ruleId, "npm-registry-write");
  assert.equal(evaluateCommand("yarn npm tag add package@1.0.0 latest").ruleId, "npm-registry-write");
  assert.equal(evaluateCommand("npm config set registry https://registry.example").decision, "confirm");
  assert.equal(evaluateCommand("npm set registry=https://registry.example").decision, "confirm");
  assert.equal(
    evaluateCommand("npm pkg set dependencies.lodash=4.17.21").decision,
    "deny",
  );
  assert.equal(evaluateCommand("npm unknown-command").decision, "confirm");
});

test("routes normalized hook payloads", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "pnpm add zod" },
    }).decision,
    "deny",
  );
  assert.equal(evaluatePolicy({ tool_name: "Read", tool_input: { path: "package.json" } }).decision, "allow");
});

test("fails conservatively on malformed commands", () => {
  // Unparseable syntax is guidelines-security-shell's confirm; this gate
  // stays quiet instead of stacking a duplicate paragraph into the prompt.
  assert.equal(
    evaluateCommand('npm install "unfinished').ruleId,
    "ambiguity-deferred-to-shell-gate",
  );
  assert.equal(evaluatePolicy(null).decision, "deny");
});

test("allows dry-run publish previews but keeps real registry writes gated", () => {
  assert.equal(evaluateCommand("npm publish --dry-run").ruleId, "registry-write-dry-run");
  assert.equal(
    evaluateCommand("npm pack --dry-run > /tmp/package-review.txt 2>&1").decision,
    "allow",
  );
  assert.equal(evaluateCommand("cd pkg && npm publish --dry-run 2>&1 | tail -5").decision, "allow");
  assert.equal(evaluateCommand("yarn npm publish --dry-run").decision, "allow");
  assert.equal(evaluateCommand("npm pack --dry-run").ruleId, "registry-write-dry-run");
  assert.equal(evaluateCommand("npm pack lodash --dry-run").decision, "deny");
  assert.equal(evaluateCommand("npm publish").decision, "confirm");
});

test("skips heredoc bodies so script content cannot poison classification", () => {
  assert.equal(
    evaluateCommand("python3 - <<'PY'\ns = \"it's fine\"\nprint(s)\nPY").decision,
    "allow",
  );
  // Work chained after the heredoc is still seen.
  assert.equal(evaluateCommand("cat <<'EOF' > f\nquote's\nEOF\nnpx cowsay").decision, "deny");
});

test("CLI maps allow, confirm, and deny to stable exit codes", () => {
  const cases = [
    ["npm test", 0, "routine-package-manager-command"],
    ["npm publish", 1, "npm-registry-write"],
    ["npx cowsay", 2, "one-off-package-runner"],
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
