import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guardScript = fileURLToPath(new URL("../scripts/guard.mjs", import.meta.url));
const policies = {
  git: fileURLToPath(new URL("../../guidelines-git/scripts/policy.mjs", import.meta.url)),
  local: fileURLToPath(
    new URL("../../guidelines-security-local/scripts/policy.mjs", import.meta.url),
  ),
  npm: fileURLToPath(
    new URL("../../guidelines-security-npm/scripts/policy.mjs", import.meta.url),
  ),
  shell: fileURLToPath(
    new URL("../../guidelines-security-shell/scripts/policy.mjs", import.meta.url),
  ),
};

function runGuard(policy, payload, extraArgs = []) {
  const args = policy === null ? [guardScript, ...extraArgs] : [guardScript, policy, ...extraArgs];
  const run = spawnSync(process.execPath, args, {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  if (run.stdout.trim() === "") return null;
  return JSON.parse(run.stdout).hookSpecificOutput;
}

function bashPayload(command, cwd) {
  const payload = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
  if (cwd) payload.cwd = cwd;
  return payload;
}

test("stays silent on allow so native permissions remain authoritative", () => {
  assert.equal(runGuard(policies.git, bashPayload("git status --short")), null);
  assert.equal(runGuard(policies.local, bashPayload("ls -la src/")), null);
  assert.equal(runGuard(policies.npm, bashPayload("npm test")), null);
});

test("translates confirm to ask with the policy reason and next action", () => {
  const push = runGuard(policies.git, bashPayload("git push origin HEAD"));
  assert.equal(push.permissionDecision, "ask");
  assert.match(push.permissionDecisionReason, /^\[git-push\]/u);
  assert.match(push.permissionDecisionReason, /推送前确认仓库的推送远端/u);

  const install = runGuard(policies.npm, bashPayload("npm ci --ignore-scripts"));
  assert.equal(install.permissionDecision, "ask");
  assert.match(install.permissionDecisionReason, /^\[scripts-disabled-install\]/u);
});

test("translates deny with the policy reason", () => {
  const gh = runGuard(policies.git, bashPayload("gh auth setup-git"));
  assert.equal(gh.permissionDecision, "deny");
  assert.match(gh.permissionDecisionReason, /^\[gh-auth-setup-git\]/u);

  const npx = runGuard(policies.npm, bashPayload("npx cowsay hello"));
  assert.equal(npx.permissionDecision, "deny");

  const env = runGuard(policies.local, {
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/workspace/.env" },
  });
  assert.equal(env.permissionDecision, "deny");
  assert.match(env.permissionDecisionReason, /^\[protected-env-file\]/u);
});

test("asks for name-heuristic workspace paths through the local policy", (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "guard-ws-"));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspace, "secrets"));

  const result = runGuard(
    policies.local,
    bashPayload("cat secrets/config.yaml", workspace),
  );
  assert.equal(result.permissionDecision, "ask");
  assert.match(result.permissionDecisionReason, /^\[workspace-name-heuristic\]/u);
});

test("raises the configured deny exit code for fail-open hosts", () => {
  const denyPayload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "sudo id" },
  });
  const withCode = spawnSync(process.execPath, [guardScript, policies.shell, "--deny-exit", "2"], {
    input: denyPayload,
    encoding: "utf8",
  });
  assert.equal(withCode.status, 2);
  assert.equal(JSON.parse(withCode.stdout).hookSpecificOutput.permissionDecision, "deny");

  // Default stays 0 so the JSON verdict is the only signal where that is enough.
  const without = spawnSync(process.execPath, [guardScript, policies.shell], {
    input: denyPayload,
    encoding: "utf8",
  });
  assert.equal(without.status, 0);

  // An allow never raises the code, whatever the host needs.
  const allowed = spawnSync(process.execPath, [guardScript, policies.shell, "--deny-exit", "2"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls -la" } }),
    encoding: "utf8",
  });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout.trim(), "");
});

test("echoes the incoming hook event so a reply stays valid off PreToolUse", () => {
  const result = runGuard(policies.shell, {
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "sudo id" },
  });
  assert.equal(result.hookEventName, "PermissionRequest");
  assert.equal(result.permissionDecision, "deny");

  // Absent field keeps the documented default.
  const fallback = runGuard(policies.shell, {
    tool_name: "Bash",
    tool_input: { command: "sudo id" },
  });
  assert.equal(fallback.hookEventName, "PreToolUse");
});

test("a guard that cannot start must not read as approval", () => {
  // Hosts treat a non-2 exit as a non-blocking error and run the command, so
  // the registered command pairs the guard with `|| exit 2`. Prove the crash
  // path exits non-zero and prints nothing that could be read as a verdict.
  const crashed = spawnSync(process.execPath, [`${guardScript}.missing`], {
    input: "{}",
    encoding: "utf8",
  });
  assert.notEqual(crashed.status, 0);
  assert.equal(crashed.stdout.trim(), "");
});

test("fails closed on misconfiguration and malformed payloads", () => {
  assert.equal(runGuard(null, "{}").permissionDecision, "deny");
  assert.equal(runGuard(policies.git, "not json").permissionDecision, "deny");
  assert.equal(
    runGuard(path.join(os.tmpdir(), "missing-policy.mjs"), "{}").permissionDecision,
    "deny",
  );
});
