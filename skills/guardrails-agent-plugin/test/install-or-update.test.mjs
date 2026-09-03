import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../scripts/install-or-update.mjs", import.meta.url));

function sandbox(context, { codex = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guardrails-install-"));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CODEX_HOME;
  if (codex) env.CODEX_HOME = path.join(home, ".codex");
  return { home, env };
}

function run(env, args) {
  const result = spawnSync(process.execPath, [installer, ...args], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ourEntries(file) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  return (config.hooks?.PreToolUse ?? [])
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => String(hook.statusMessage ?? "").startsWith("guardrails:"));
}

test("installs every policy and is idempotent on re-run", (context) => {
  const { home, env } = sandbox(context);
  const file = path.join(home, ".claude", "settings.json");

  const first = run(env, ["--install", "--host", "claude-code"]);
  assert.equal(first.status, 0);
  assert.equal(ourEntries(file).length, 4);
  for (const entry of ourEntries(file)) {
    assert.match(entry.command, /\|\| exit 2$/u, "every entry must fail closed on a crash");
  }

  const second = run(env, ["--install", "--host", "claude-code"]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /unchanged/u);
  assert.equal(ourEntries(file).length, 4, "re-install must not append duplicates");
});

test("preserves unrelated hooks and settings", (context) => {
  const { home, env } = sandbox(context);
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      permissions: { allow: ["Bash"], deny: ["Read(.env)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }],
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
    }),
  );

  assert.equal(run(env, ["--install", "--host", "claude-code"]).status, 0);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const commands = config.hooks.PreToolUse.flatMap((group) => group.hooks).map((h) => h.command);
  assert.ok(commands.includes("echo mine"), "existing PreToolUse hook survives");
  assert.equal(config.hooks.Stop[0].hooks[0].command, "echo stop");
  assert.deepEqual(config.permissions.deny, ["Read(.env)"]);
  assert.ok(fs.existsSync(`${file}.guardrails-backup`));
});

test("reports registered-stale when a command drifts, then repairs it", (context) => {
  const { home, env } = sandbox(context);
  const file = path.join(home, ".claude", "settings.json");
  run(env, ["--install", "--host", "claude-code"]);

  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.hooks.PreToolUse[0].hooks[0].command = "node /stale/path.mjs";
  fs.writeFileSync(file, JSON.stringify(config, null, 2));

  const check = run(env, ["--check", "--host", "claude-code"]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /registered-stale/u);

  run(env, ["--install", "--host", "claude-code"]);
  assert.equal(run(env, ["--check", "--host", "claude-code"]).status, 0);
  assert.equal(ourEntries(file).length, 4, "repair must not duplicate");
});

test("reports registered-stale when a matcher drifts", (context) => {
  const { home, env } = sandbox(context);
  const file = path.join(home, ".claude", "settings.json");
  run(env, ["--install", "--host", "claude-code"]);

  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.hooks.PreToolUse[0].matcher = "*";
  fs.writeFileSync(file, JSON.stringify(config, null, 2));

  const check = run(env, ["--check", "--host", "claude-code"]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /registered-stale/u);
});

test("uses a longer Codex timeout for the local confirmation dialog", (context) => {
  const { home, env } = sandbox(context, { codex: true });
  const file = path.join(home, ".codex", "hooks.json");
  run(env, ["--install", "--host", "codex"]);

  assert.ok(ourEntries(file).every((entry) => entry.timeout === 75));
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.hooks.PreToolUse[0].hooks[0].timeout = 15;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  assert.equal(run(env, ["--check", "--host", "codex"]).status, 1);
  assert.match(run(env, ["--check", "--host", "codex"]).stdout, /registered-stale/u);
});

test("reports policy state for the selected host only", (context) => {
  const { home, env } = sandbox(context, { codex: true });
  run(env, ["--install", "--host", "claude-code"]);
  run(env, ["--install", "--host", "codex"]);

  const claudeFile = path.join(home, ".claude", "settings.json");
  const config = JSON.parse(fs.readFileSync(claudeFile, "utf8"));
  config.hooks.PreToolUse[0].hooks[0].command = "node /stale/path.mjs";
  fs.writeFileSync(claudeFile, JSON.stringify(config, null, 2));

  const codex = JSON.parse(run(env, ["--check", "--host", "codex", "--json"]).stdout);
  assert.ok(codex.policies.every((entry) => entry.state === "registered"));

  const claude = JSON.parse(
    run(env, ["--check", "--host", "claude-code", "--json"]).stdout,
  );
  assert.ok(claude.policies.some((entry) => entry.state === "registered-stale"));
});

test("uses host-specific matchers", (context) => {
  const claude = sandbox(context);
  run(claude.env, ["--install", "--host", "claude-code"]);
  const claudeConfig = JSON.parse(
    fs.readFileSync(path.join(claude.home, ".claude", "settings.json"), "utf8"),
  );
  const claudeLocal = claudeConfig.hooks.PreToolUse.find((group) =>
    group.hooks.some((h) => h.statusMessage === "guardrails:guidelines-security-local"),
  );
  assert.match(claudeLocal.matcher, /WebFetch/u);

  const codex = sandbox(context, { codex: true });
  run(codex.env, ["--install", "--host", "codex"]);
  const codexConfig = JSON.parse(
    fs.readFileSync(path.join(codex.home, ".codex", "hooks.json"), "utf8"),
  );
  const codexLocal = codexConfig.hooks.PreToolUse.find((group) =>
    group.hooks.some((h) => h.statusMessage === "guardrails:guidelines-security-local"),
  );
  const codexShell = codexConfig.hooks.PreToolUse.find((group) =>
    group.hooks.some((h) => h.statusMessage === "guardrails:guidelines-security-shell"),
  );
  const codexGit = codexConfig.hooks.PreToolUse.find((group) =>
    group.hooks.some((h) => h.statusMessage === "guardrails:guidelines-git"),
  );
  const codexNpm = codexConfig.hooks.PreToolUse.find((group) =>
    group.hooks.some((h) => h.statusMessage === "guardrails:guidelines-security-npm"),
  );
  assert.match(codexLocal.matcher, /apply_patch/u);
  assert.match(codexShell.matcher, /apply_patch/u);
  assert.doesNotMatch(codexGit.matcher, /apply_patch/u);
  assert.doesNotMatch(codexNpm.matcher, /apply_patch/u);
  assert.match(codexLocal.hooks[0].command, /--host codex/u);
  assert.match(claudeLocal.hooks[0].command, /--host claude-code/u);
  assert.equal(run(codex.env, ["--check", "--host", "codex"]).status, 0);
});

test("compensates for a fail-open host with an explicit deny exit code", (context) => {
  const { home, env } = sandbox(context);
  const result = run(env, ["--install", "--host", "cursor"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /fails open/u, "must report the residual gap");

  const config = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "hooks.json"), "utf8"));
  const command = config.hooks.PreToolUse[0].hooks[0].command;
  assert.match(command, /--deny-exit 2/u);
  assert.match(command, /\|\| exit 2$/u, "a crashed guard must still block");

  // Claude Code keeps exit 0; the JSON verdict is authoritative there.
  const claude = sandbox(context);
  run(claude.env, ["--install", "--host", "claude-code"]);
  const claudeConfig = JSON.parse(
    fs.readFileSync(path.join(claude.home, ".claude", "settings.json"), "utf8"),
  );
  assert.doesNotMatch(claudeConfig.hooks.PreToolUse[0].hooks[0].command, /--deny-exit/u);
});

test("surfaces the Codex trust step", (context) => {
  const { env } = sandbox(context, { codex: true });
  const result = run(env, ["--install", "--host", "codex"]);
  assert.match(result.stdout, /\/hooks/u);
  assert.match(result.stdout, /trust/iu);
});

test("reports a registration it did not write instead of shadowing it", (context) => {
  const { home, env } = sandbox(context);
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Something else already gates the same policy through its own adapter.
  fs.writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: 'node "/somewhere/other-guard.mjs" "/skills/guidelines-git/scripts/policy.mjs"',
              },
            ],
          },
        ],
      },
    }),
  );

  const check = run(env, ["--check", "--host", "claude-code"]);
  assert.match(check.stdout, /registered-unmarked/u);
  assert.match(check.stdout, /not written here/u, "must explain why it matters");
  assert.match(check.stdout, /stricter verdict wins/u);

  const report = JSON.parse(run(env, ["--check", "--host", "claude-code", "--json"]).stdout);
  const unmarked = report.existingRegistrations.filter((f) => f.state === "registered-unmarked");
  assert.equal(unmarked.length, 1);
  assert.equal(unmarked[0].policy, "guidelines-git");

  // Removing another tool's entry is the user's call, so install leaves it alone.
  run(env, ["--install", "--host", "claude-code"]);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  const commands = after.hooks.PreToolUse.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(commands.some((c) => c.includes("other-guard.mjs")), "foreign entry survives");
});

test("refuses to guess the host", (context) => {
  const { home, env } = sandbox(context);
  assert.equal(run(env, ["--check"]).status, 2, "no evidence means unresolved");

  const install = run(env, ["--install"]);
  assert.equal(install.status, 2);
  assert.match(install.stdout, /unresolved-host/u);

  // A config file proves the host is installed, not that it is running.
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  fs.writeFileSync(path.join(home, ".cursor", "hooks.json"), "{}");
  const candidate = run(env, ["--check"]);
  assert.match(candidate.stdout, /candidate-needs-confirmation/u);
  assert.match(candidate.stdout, /--host cursor/u);
});

test("refuses hosts it does not write", (context) => {
  const { env } = sandbox(context);
  // Known well enough to find an existing install, not well enough to write one.
  const result = run(env, ["--install", "--host", "gemini-cli"]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /host-not-installable-here/u);
  assert.equal(run(env, ["--install", "--host", "windsurf"]).status, 2);
});

test("detects the host from the environment", (context) => {
  const { env } = sandbox(context);
  const claude = run({ ...env, CLAUDECODE: "1" }, ["--check"]);
  assert.match(claude.stdout, /Claude Code \(via environment\)/u);

  const codex = sandbox(context, { codex: true });
  assert.match(run(codex.env, ["--check"]).stdout, /Codex \(via environment\)/u);
});

test("verify self-tests the guard pipeline", (context) => {
  const { env } = sandbox(context);
  const result = run(env, ["--verify"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /pipeline: ok/u);
  assert.match(result.stdout, /rule-id/u, "must explain how to tell our blocks apart");
});

test("verify covers the non-interactive Codex confirm fallback", (context) => {
  const { env } = sandbox(context, { codex: true });
  const result = run(env, ["--verify", "--host", "codex", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const confirmation = report.results.find(
    (entry) => entry.expect === "confirm" && entry.command !== "git push origin HEAD",
  );
  assert.equal(confirmation.got, "deny");
  assert.equal(confirmation.ok, true);
  const push = report.results.find((entry) => entry.command === "git push origin HEAD");
  assert.equal(push.got, "allow");
  assert.equal(push.ok, true);
  assert.match(report.inSessionChecks.join("\n"), /Codex 安全确认/u);
  assert.match(report.inSessionChecks.join("\n"), /codex-confirm-declined/u);
});

test("dry run reports actions without writing", (context) => {
  const { home, env } = sandbox(context);
  const result = run(env, ["--install", "--host", "claude-code", "--dry-run"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[dry-run\]/u);
  assert.equal(fs.existsSync(path.join(home, ".claude", "settings.json")), false);
});

test("json output is machine readable", (context) => {
  const { env } = sandbox(context);
  const check = run(env, ["--check", "--host", "claude-code", "--json"]);
  const report = JSON.parse(check.stdout);
  assert.equal(report.host, "claude-code");
  assert.equal(report.policies.length, 4);
  assert.ok(report.policies.every((entry) => entry.state === "not-registered"));
});
