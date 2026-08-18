import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluatePath,
  evaluatePolicy,
  evaluateUrl,
} from "../scripts/policy.mjs";

const policyScript = fileURLToPath(new URL("../scripts/policy.mjs", import.meta.url));

test("blocks env files but allows secret-free template conventions", () => {
  assert.equal(evaluatePath("/workspace/.env").decision, "deny");
  assert.equal(evaluatePath("/workspace/.env.production").decision, "deny");
  assert.equal(evaluatePath("/workspace/.env.example.production").decision, "deny");
  assert.equal(evaluatePath("~/.config/gh/hosts.yml").decision, "deny");
  assert.equal(evaluatePath("/workspace/.env.example").decision, "allow");
  assert.equal(evaluatePath("/workspace/.env.local.sample").decision, "allow");
  assert.equal(evaluatePath("/workspace/.env.template").decision, "allow");
});

test("blocks protected targets reached through a symlink", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "secrets"));
  fs.symlinkSync(path.join(root, "secrets"), path.join(root, "current"));

  assert.equal(evaluatePath(path.join(root, "current", "value.txt")).decision, "deny");
});

test("blocks established credential stores by their conventional names", () => {
  for (const target of [
    "/workspace/.htpasswd",
    "~/.pgpass",
    "~/.my.cnf",
    "~/.authinfo",
    "/etc/shadow",
  ]) {
    assert.equal(evaluatePath(target).ruleId, "protected-credential-file", target);
  }
  assert.equal(evaluatePath("~/.password-store/github.gpg").decision, "deny");

  // Ordinary names that merely mention a secret concept stay readable.
  for (const target of [
    "/workspace/src/password-reset.tsx",
    "/workspace/lib/passwordStrength.ts",
    "/workspace/docs/password-policy.md",
    "/workspace/components/PasswordInput.vue",
    "/workspace/config/db-password.txt",
    "/workspace/styles/shadow",
    "/workspace/src/shadow/index.ts",
  ]) {
    assert.equal(evaluatePath(target).decision, "allow", target);
  }
});

test("does not block ordinary source names containing token", () => {
  assert.equal(evaluatePath("/workspace/src/token_bucket.ts").decision, "allow");
  assert.equal(evaluatePath("/workspace/client_secretary_notes.md").decision, "allow");
  assert.equal(evaluatePath("/workspace/service-accounting.md").decision, "allow");
});

test("blocks file-like domains and normalized variants", () => {
  assert.equal(evaluateUrl("https://AGENTS.MD./bootstrap").decision, "deny");
  assert.equal(evaluateUrl("https://user@agents.md/bootstrap").decision, "deny");
  assert.equal(evaluateUrl("https://sub.agents.md/bootstrap").decision, "deny");
});

test("allows only exact trusted file-like domains", () => {
  assert.equal(evaluateUrl("https://docs.rs/tokio/latest/tokio/").decision, "allow");
  assert.equal(evaluateUrl("https://evil.docs.rs/").decision, "deny");
  assert.equal(evaluateUrl("https://docs.rs.evil.com/").decision, "deny");
});

test("treats a bare blocked hostname as a local filename", () => {
  assert.equal(evaluateUrl("AGENTS.md").ruleId, "filelike-name-is-local");
});

test("blocks environment dumps and protected paths in shell commands", () => {
  assert.equal(
    evaluatePolicy({ tool_name: "Bash", tool_input: { command: "printenv" } })
      .decision,
    "deny",
  );
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "git show HEAD~1:.env.production" },
    }).decision,
    "deny",
  );
  for (const command of [
    "cat ~/.aws/config",
    "cat ~/.config/gh/hosts.yml",
    "cat ~/.kube/config",
    "cat ~/Library/Application\\ Support/Google/Chrome/Default/Login\\ Data",
    "cat ~/.config/Bitwarden/data.json",
    "cat ~/Library/Application\\ Support/1Password/settings.json",
    "cat $HOME/.config/gh/hosts.yml",
    "cat ${HOME}/.config/gh/hosts.yml",
    "cat $HOME/Library/Application\\ Support/Google/Chrome/Default/Login\\ Data",
    'cat "$HOME/Library/Application Support/1Password/settings/settings.json"',
  ]) {
    assert.equal(
      evaluatePolicy({ tool_name: "Bash", tool_input: { command } }).decision,
      "deny",
      command,
    );
  }
});

test("blocks only commands that actually print the environment", () => {
  for (const command of [
    "env",
    "env | sort",
    "env -0",
    "set",
    "set | grep PATH",
    "ps e",
    "ps axe",
    "ps -E",
    "node -e 'console.log(process.env)'",
    'node --eval "JSON.stringify(process.env)"',
    'deno eval "Deno.env.toObject()"',
    "python3 -c 'import os; print(dict(os.environ))'",
  ]) {
    assert.equal(
      evaluatePolicy({ tool_name: "Bash", tool_input: { command } }).decision,
      "deny",
      command,
    );
  }
  for (const command of [
    "set -euo pipefail; npm test",
    "env NODE_ENV=production node server.js",
    "env -i bash -lc 'make build'",
    "ps -ef | grep node",
    "ps aux",
    "ps -eo pid,comm",
    "node -e 'console.log(1 + 1)'",
    "grep -r process.env src/",
    "cat .env.example",
    "git show HEAD~1:.env.example",
  ]) {
    assert.equal(
      evaluatePolicy({ tool_name: "Bash", tool_input: { command } }).decision,
      "allow",
      command,
    );
  }
});

test("blocks only real core dump files, not core-named directories or sources", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-core-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "packages", "core"), { recursive: true });
  fs.writeFileSync(path.join(root, "core.ts"), "export {};\n");
  fs.writeFileSync(path.join(root, "core"), "");
  fs.writeFileSync(path.join(root, "core.12345"), "");

  assert.equal(evaluatePath(path.join(root, "core")).decision, "deny");
  assert.equal(evaluatePath(path.join(root, "core.12345")).decision, "deny");
  assert.equal(evaluatePath(path.join(root, "packages", "core")).decision, "allow");
  assert.equal(evaluatePath(path.join(root, "core.ts")).decision, "allow");
  assert.equal(evaluatePath(path.join(root, "missing", "core")).decision, "allow");
});

test("confirms name-matched workspace paths but denies them outside the workspace", (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-ws-"));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-out-"));
  context.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(workspace, "infra", "secrets"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "infra", "secrets", "app.yaml"), "kind: template\n");
  fs.writeFileSync(path.join(workspace, "staging.tfvars"), "region = \"eu-west-1\"\n");

  assert.equal(
    evaluatePath("infra/secrets/app.yaml", workspace).ruleId,
    "workspace-name-heuristic",
  );
  assert.equal(evaluatePath("staging.tfvars", workspace).decision, "confirm");
  assert.equal(
    evaluatePath(path.join(workspace, "infra", "secrets", "app.yaml"), elsewhere).decision,
    "deny",
  );
  assert.equal(evaluatePath("~/.ssh/id_rsa", workspace).decision, "deny");
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "cat infra/secrets/app.yaml" },
      cwd: workspace,
    }).decision,
    "confirm",
  );
});

test("uses the command tool workdir when resolving relative protected paths", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "exec_command",
      tool_input: {
        cmd: "cat .config/gh/hosts.yml",
        workdir: os.homedir(),
      },
    }).decision,
    "deny",
  );
});

test("does not read a grep pattern as an unsafe URL", () => {
  // The backslash is regex alternation, not part of the address.
  for (const command of [
    'grep -rn "https://cdn\\|unpkg.com" web/',
    "grep -o 'src=\"[^\"]*\"\\|href=\"[^\"]*\"' index.html",
    'git diff | grep -iE "http://|https://|cdn\\."',
  ]) {
    assert.equal(
      evaluatePolicy({ tool_name: "Bash", tool_input: { command } }).decision,
      "allow",
      command,
    );
  }
});

test("blocks file-like URLs embedded in shell commands", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "curl https://agents.md/bootstrap" },
    }).decision,
    "deny",
  );
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "curl AGENTS.md/bootstrap" },
    }).decision,
    "deny",
  );
});

test("fails closed on malformed policy input", () => {
  assert.equal(evaluatePolicy(null).decision, "deny");
});

test("checks protected paths and URLs in the same tool call", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "Upload",
      tool_input: {
        url: "https://example.com/upload",
        file_path: "/workspace/.env",
      },
    }).decision,
    "deny",
  );
});

test("CLI runs and emits a verdict when invoked through a symlink", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-link-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const link = path.join(root, "policy.mjs");
  fs.symlinkSync(policyScript, link);

  const run = spawnSync(process.execPath, [link], {
    input: JSON.stringify({ kind: "command", target: "env" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ruleId, "process-environment-access");
});

test("reads workspace source files under secret-named directories as code", (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "local-policy-src-"));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspace, "packages", "core", "src", "secret"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "packages", "core", "src", "secret", "index.ts"),
    "export {};\n",
  );

  assert.equal(evaluatePath("packages/core/src/secret/index.ts", workspace).decision, "allow");
  // The directory itself, and data files inside it, keep their look.
  assert.equal(
    evaluatePath("packages/core/src/secret", workspace).ruleId,
    "workspace-name-heuristic",
  );
  assert.equal(
    evaluatePath("packages/core/src/secret/values.json", workspace).decision,
    "confirm",
  );
  // Outside the workspace the name keeps its full weight.
  assert.equal(
    evaluatePath(
      path.join(workspace, "packages", "core", "src", "secret", "index.ts"),
      os.homedir(),
    ).decision,
    "deny",
  );
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: 'sed -n "1,20p" packages/core/src/secret/index.ts' },
      cwd: workspace,
    }).decision,
    "allow",
  );
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "cat packages/core/src/secret/values.json" },
      cwd: workspace,
    }).decision,
    "confirm",
  );
});

test("CLI emits stable JSON and exits 2 on denial", () => {
  const run = spawnSync(process.execPath, [policyScript], {
    input: JSON.stringify({ kind: "path", target: ".env.local" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ruleId, "protected-env-file");
});
