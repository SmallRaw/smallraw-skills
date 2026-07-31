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

test("confirms cache-only npx runs but blocks flags that still download", () => {
  const offline = evaluateCommand("npx --offline prettier --check .");
  assert.equal(offline.decision, "confirm");
  assert.equal(offline.ruleId, "cache-only-package-runner");
  assert.equal(evaluateCommand("npx --no-install prettier --check .").decision, "deny");
  assert.equal(evaluateCommand("npx prettier --offline").decision, "deny");
});

test("confirms scripts-disabled installs while blocking script-enabled ones", () => {
  const result = evaluateCommand("npm ci --ignore-scripts");
  assert.equal(result.decision, "confirm");
  assert.equal(result.ruleId, "scripts-disabled-install");
  assert.equal(evaluateCommand("pnpm install --ignore-scripts").decision, "confirm");
  assert.equal(evaluateCommand("npm ci").decision, "deny");
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
  assert.equal(evaluateCommand('npm install "unfinished').decision, "confirm");
  assert.equal(evaluatePolicy(null).decision, "deny");
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
