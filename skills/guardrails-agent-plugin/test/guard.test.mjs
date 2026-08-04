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

test("reads commands out of a payload that carries them inside source", () => {
  // Codex's exec tool takes a JS program, so the command is a literal in code
  // rather than a field. Read as "not a shell call", it ran unguarded.
  const exec = (source) => runGuard(policies.git, { tool_name: "exec", input: source });

  const gated = exec('const r = await tools.exec_command({ cmd: "git update-ref refs/heads/x abc" });');
  assert.equal(gated.permissionDecision, "ask");
  assert.match(gated.permissionDecisionReason, /history-or-branch-mutation/u);

  assert.equal(exec('await tools.exec_command({ cmd: "git status --short" });'), null);

  // Several calls in one program: the strictest verdict wins.
  const mixed = exec(
    'await tools.exec_command({ cmd: "git status" });\nawait tools.exec_command({ cmd: "gh auth setup-git" });',
  );
  assert.equal(mixed.permissionDecision, "deny");

  // A command assembled at runtime cannot be read statically; say so rather
  // than treat unreadable as harmless.
  const dynamic = exec("const c = buildCmd(); await tools.exec_command({ cmd: c });");
  assert.equal(dynamic.permissionDecision, "ask");
  assert.match(dynamic.permissionDecisionReason, /unreadable-embedded-command/u);

  const interpolated = exec("await tools.exec_command({ cmd: `git push ${remote}` });");
  assert.equal(interpolated.permissionDecision, "ask");

  // The plain shape still works unchanged.
  const plain = runGuard(policies.git, {
    tool_name: "Bash",
    tool_input: { command: "gh auth setup-git" },
  });
  assert.equal(plain.permissionDecision, "deny");
});

test("a spelling the extraction did not anticipate must not read as approval", () => {
  // Each of these runs `gh auth setup-git`. Guessing which field carries the
  // command is what let one through, so an execution-named tool whose command
  // cannot be read is treated as unread, not as harmless.
  const payloads = [
    { tool_name: "exec", input: 'await tools.exec_command({ "cmd": "gh auth setup-git" });' },
    { tool_name: "exec", input: "await tools.exec_command({ 'cmd': 'gh auth setup-git' });" },
    { tool_name: "exec", input: 'await tools.exec_command({ cmd: "gh auth " + "setup-git" });' },
    { tool_name: "exec", input: 'await tools.exec_command({ cmd: ["gh","auth","setup-git"] });' },
    { tool_name: "exec", input: 'await tools.exec_command({ script: "gh auth setup-git" });' },
    {
      tool_name: "exec",
      tool_input: { arguments: 'await tools.exec_command({ cmd: "gh auth setup-git" });' },
    },
    { tool_name: "run_terminal", tool_input: { command: "gh auth setup-git" } },
    { tool_name: "shell_exec", input: 'await tools.exec_command({ cmd: "gh auth setup-git" });' },
  ];
  for (const payload of payloads) {
    const result = runGuard(policies.git, payload);
    assert.ok(result, `silently allowed: ${JSON.stringify(payload).slice(0, 70)}`);
    assert.notEqual(result.permissionDecision, "allow");
  }
});

test("does not treat ordinary work as an unreadable command", () => {
  // Deep search only applies to tools that exist to run things, so file content
  // that merely mentions a command stays out of it.
  assert.equal(
    runGuard(policies.local, {
      tool_name: "Write",
      tool_input: { file_path: "a.js", content: 'const x = { cmd: "rm -rf /" };' },
    }),
    null,
  );
  assert.equal(
    runGuard(policies.git, {
      tool_name: "exec",
      input: 'await tools.exec_command({ cmd: "git status --short" });',
    }),
    null,
  );
});

test("fails closed on misconfiguration and malformed payloads", () => {
  assert.equal(runGuard(null, "{}").permissionDecision, "deny");
  assert.equal(runGuard(policies.git, "not json").permissionDecision, "deny");
  assert.equal(
    runGuard(path.join(os.tmpdir(), "missing-policy.mjs"), "{}").permissionDecision,
    "deny",
  );
});
