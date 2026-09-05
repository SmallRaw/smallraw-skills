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
  assert.equal(runGuard(policies.shell, bashPayload("bash -c 'printf ok'")), null);
});

test("reads literal shell wrappers without mistaking xargs data for source", () => {
  const destructive = runGuard(policies.shell, bashPayload("bash -c 'rm -rf /'"));
  assert.equal(destructive.permissionDecision, "deny");
  assert.match(destructive.permissionDecisionReason, /critical-root-deletion/u);

  const template = runGuard(
    policies.shell,
    bashPayload(`find . -type f -print0 | xargs -0 -I{} sh -c 'sed -n "1p" "{}"'`),
  );
  assert.equal(template.permissionDecision, "deny");
  assert.match(template.permissionDecisionReason, /shell-template-expansion/u);

  assert.equal(
    runGuard(
      policies.shell,
      bashPayload(
        `find . -type f -print0 | xargs -0 -I{} sh -c 'sed -n "1p" "$1"' sh {}`,
      ),
    ),
    null,
  );
});

test("translates confirm to ask with the policy reason and next action", () => {
  const push = runGuard(policies.git, bashPayload("git push origin HEAD"));
  assert.equal(push.permissionDecision, "ask");
  assert.match(push.permissionDecisionReason, /^\[git-push\]/u);
  // The reason has to name where it lands; "a push is happening" is not a thing
  // anyone can answer.
  assert.match(push.permissionDecisionReason, /origin HEAD/u);

  const install = runGuard(policies.npm, bashPayload("yarn install --ignore-scripts"));
  assert.equal(install.permissionDecision, "ask");
  assert.match(install.permissionDecisionReason, /^\[scripts-disabled-install\]/u);
});

test("lets Codex perform a normal push after conversational authorization", () => {
  const normal = runGuard(
    policies.git,
    bashPayload("git push origin HEAD"),
    ["--host", "codex"],
  );
  assert.equal(normal, null);

  const forced = runGuard(
    policies.git,
    bashPayload("git push --force-with-lease origin HEAD"),
    ["--host", "codex"],
  );
  assert.equal(forced.permissionDecision, "deny");
  assert.match(forced.permissionDecisionReason, /^\[codex-confirm-unavailable\]/u);
  assert.match(forced.permissionDecisionReason, /\[force-push\]/u);
});

test("a refusal carries both halves, an ask only the first", () => {
  // Layer one is the policy's: what happened, and the spelling that does the
  // same job without approval. Layer two is what to do when there is no such
  // spelling — it belongs on the refusal, and it has to travel with the message
  // because the guideline file loads in a fraction of sessions.
  const refused = runGuard(policies.npm, bashPayload("yarn install"));
  assert.equal(refused.permissionDecision, "deny");
  assert.match(refused.permissionDecisionReason, /--ignore-scripts/u);
  assert.match(refused.permissionDecisionReason, /收尾时一并提出来/u);

  // An ask is already in front of the user, so batching advice would be late.
  const asked = runGuard(policies.git, bashPayload("git push origin main"));
  assert.equal(asked.permissionDecision, "ask");
  assert.doesNotMatch(asked.permissionDecisionReason, /收尾时一并提出来/u);
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

test("opens a wrapper so a gate is not left reading a quoted string", () => {
  // One wrapper can carry a push, a publish, a deletion and a secret read at
  // once. Every policy reads only the text it is handed, so without opening it
  // the gates that care about each of those see nothing.
  const inner = "git push origin main && rm -rf ~/notes";
  for (const command of [
    `bash -c '${inner}'`,
    `X=$(${inner})`,
    "X=`" + inner + "`",
    `echo x | xargs -I{} sh -c '${inner}'`,
  ]) {
    const seen = runGuard(policies.git, bashPayload(command));
    assert.equal(seen?.permissionDecision, "ask", command);
    assert.match(seen.permissionDecisionReason, /git-push/u, command);
  }

  // A payload that only exists after expansion cannot be judged at all.
  for (const command of ['bash -c "$CMD"', 'CMD=$(cat cmds.txt); bash -c "$CMD"']) {
    const seen = runGuard(policies.git, bashPayload(command));
    assert.equal(seen?.permissionDecision, "deny", command);
    assert.match(seen.permissionDecisionReason, /unreadable-wrapper/u, command);
  }

  // A literal parked in a variable in the same command is still literal.
  const resolved = runGuard(policies.git, bashPayload(`CMD='git push --force'; bash -c "$CMD"`));
  assert.match(resolved.permissionDecisionReason, /force-push/u);

  // `grep -c` is a count flag, not a shell payload.
  assert.equal(runGuard(policies.git, bashPayload(`grep -c '^git push' notes.txt`)), null);
});

test("opens a wrapper whatever shape its flags take", () => {
  // The command flag is not always a lone `-c`: it bundles (`-lc`, `-euc`,
  // `-cx`, `-xc`), follows an option that takes an argument (`-o pipefail`),
  // and follows long flags (`--login`). Each form used to sail past every gate
  // because only a standalone `-c` token was recognised as a wrapper.
  const secret = "cat .env";
  const bundled = [
    `bash -lc '${secret}'`,
    `bash -ic '${secret}'`,
    `bash -lic '${secret}'`,
    `bash -euc '${secret}'`,
    `bash -cx '${secret}'`,
    `bash -xc '${secret}'`,
    `bash -o pipefail -c '${secret}'`,
    `bash --login -c '${secret}'`,
    `zsh -lc '${secret}'`,
    `sh -lc '${secret}'`,
  ];
  for (const command of bundled) {
    const seen = runGuard(policies.local, bashPayload(command));
    assert.equal(seen?.permissionDecision, "deny", command);
    assert.match(seen.permissionDecisionReason, /protected-path-in-command/u, command);
  }

  // The same bundled forms must route a supply-chain payload to the npm gate…
  const supply = runGuard(policies.npm, bashPayload("bash -lc 'npm install lodash'"));
  assert.equal(supply?.permissionDecision, "deny", "bash -lc npm install");
  assert.match(supply.permissionDecisionReason, /dependency-state-change/u);

  // …and a push payload to the git gate as an ask.
  const push = runGuard(policies.git, bashPayload("bash -euc 'git push --force origin main'"));
  assert.equal(push?.permissionDecision, "ask", "bash -euc git push");
  assert.match(push.permissionDecisionReason, /force-push/u);

  // A cluster with no lowercase `c` is not a command flag: `ls -la` inside a
  // pipeline word, `grep -l`, etc. must not be misread as a wrapper opener.
  assert.equal(runGuard(policies.local, bashPayload("bash -l -i")), null);
});

test("keeps quoted heredoc program text out of shell-wrapper inspection", () => {
  const data =
    "node - <<'NODE'\n" +
    "const label = `value ${name}`;\n" +
    "console.log(label);\n" +
    "NODE";
  assert.equal(runGuard(policies.shell, bashPayload(data)), null);

  const expanded = "node - <<NODE\n$(git push origin main)\nNODE";
  assert.match(
    runGuard(policies.git, bashPayload(expanded)).permissionDecisionReason,
    /git-push/u,
  );
});

test("reads commands out of a payload that carries them inside source", () => {
  // Codex's exec tool takes a JS program, so the command is a literal in code
  // rather than a field. Read as "not a shell call", it ran unguarded.
  const exec = (source) => runGuard(policies.git, { tool_name: "exec", input: source });

  const gated = exec('const r = await tools.exec_command({ cmd: "git push origin main" });');
  assert.equal(gated.permissionDecision, "ask");
  assert.match(gated.permissionDecisionReason, /git-push/u);

  const jsonStyle = exec('await tools.exec_command({"cmd":"gh auth setup-git"});');
  assert.equal(jsonStyle.permissionDecision, "deny");
  assert.match(jsonStyle.permissionDecisionReason, /gh-auth-setup-git/u);
  assert.match(
    exec("await tools.exec_command({'cmd':'gh auth setup-git'});").permissionDecisionReason,
    /gh-auth-setup-git/u,
  );

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

test("decodes escaped quotes before policies inspect an embedded command", () => {
  const source =
    'const r = await tools.exec_command({cmd:"tmpdir=$(mktemp -d /tmp/review.XXXXXX); ' +
    '[ -n \\"$tmpdir\\" ]; \\"$tmpdir/venv/bin/python\\" -m pip install ExamplePkg"});';
  const result = runGuard(policies.shell, { tool_name: "exec", input: source });
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, /install-runs-package-code/u);
});

test("judges an embedded command relative to its own workdir", (context) => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), "guard-session-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "guard-command-"));
  context.after(() => fs.rmSync(session, { recursive: true, force: true }));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const literal = JSON.stringify(workspace);
  const source = `await tools.exec_command({cmd:"rm -rf build",workdir:${literal}});`;
  const literalResult = runGuard(policies.shell, { tool_name: "exec", input: source, cwd: session });
  assert.equal(literalResult.permissionDecision, "deny");
  assert.match(literalResult.permissionDecisionReason, /permanent-deletion/u);

  const constantSource =
    `const cwd = ${literal};\n` +
    'await tools.exec_command({cmd:"rm -rf build",workdir:cwd});';
  const constantResult = runGuard(policies.shell, {
    tool_name: "exec",
    input: constantSource,
    cwd: session,
  });
  assert.equal(constantResult.permissionDecision, "deny");
  assert.match(constantResult.permissionDecisionReason, /permanent-deletion/u);

  const dynamic = runGuard(policies.shell, {
    tool_name: "exec",
    input: 'await tools.exec_command({cmd:"rm -rf build",workdir:targetDir});',
    cwd: session,
  }, ["--host", "codex"]);
  assert.equal(dynamic.permissionDecision, "deny");
  assert.match(dynamic.permissionDecisionReason, /permanent-deletion/u);
});

test("does not read TypeScript patch templates as Bash wrappers", () => {
  const backtick = String.fromCharCode(96);
  const patch =
    "*** Begin Patch\n*** Update File: src/example.ts\n@@\n+const label = " +
    backtick +
    "text ${value}" +
    backtick +
    ";\n*** End Patch";
  const payload = { tool_name: "apply_patch", tool_input: { command: patch } };

  assert.equal(runGuard(policies.shell, payload), null);

  const shellLikeText = patch.replace("text ${value}", "sudo id");
  assert.equal(
    runGuard(policies.shell, {
      ...payload,
      tool_input: { command: shellLikeText },
    }),
    null,
  );
});

test("checks patch targets without scanning patch contents as commands or paths", () => {
  const inside = {
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: src/config.ts\n@@\n+const sample = '.env';\n*** End Patch",
    },
  };
  assert.equal(runGuard(policies.shell, inside), null);
  assert.equal(runGuard(policies.local, inside), null);

  const outside = {
    ...inside,
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: ../other/config.ts\n@@\n+const value = true;\n*** End Patch",
    },
  };
  assert.equal(runGuard(policies.shell, outside).permissionDecision, "ask");

  const protectedTarget = {
    ...inside,
    tool_input: {
      command: "*** Begin Patch\n*** Update File: .env\n@@\n+TOKEN=example\n*** End Patch",
    },
  };
  assert.equal(runGuard(policies.local, protectedTarget).permissionDecision, "deny");
});

test("a spelling the extraction did not anticipate must not read as approval", () => {
  // Each of these runs `gh auth setup-git`. Guessing which field carries the
  // command is what let one through, so an execution-named tool whose command
  // cannot be read is treated as unread, not as harmless.
  const payloads = [
    { tool_name: "exec", input: 'await tools.exec_command({ cmd: "gh auth " + "setup-git" });' },
    { tool_name: "exec", input: 'await tools.exec_command({ cmd: ["gh","auth","setup-git"] });' },
    { tool_name: "exec", input: 'await tools.exec_command({ script: "gh auth setup-git" });' },
    {
      tool_name: "exec",
      input:
        'const run = tools.exec_command; await tools.apply_patch("safe"); await run({ ["cmd"]: buildCmd() });',
    },
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
