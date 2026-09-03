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
const decideCommand = (command) =>
  evaluatePolicy({ tool_name: "Bash", tool_input: { command } });

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

test("allows Claude and Codex conversation transcripts but keeps command history blocked", () => {
  const transcripts = [
    "/Users/example/.claude/projects/-workspace/session-id.jsonl",
    "/Users/example/.codex/sessions/2026/09/02/rollout-session-id.jsonl",
  ];

  for (const transcript of transcripts) {
    assert.equal(evaluatePath(transcript).decision, "allow", transcript);
    assert.equal(
      evaluatePolicy({ tool_name: "Read", tool_input: { file_path: transcript } }).decision,
      "allow",
      transcript,
    );
    assert.equal(decideCommand(`tail -n 40 ${transcript}`).decision, "allow", transcript);
  }

  for (const history of ["~/.zsh_history", "~/.python_history", "~/.viminfo"]) {
    assert.equal(evaluatePath(history).decision, "deny", history);
    assert.equal(decideCommand(`tail -n 40 ${history}`).decision, "deny", history);
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

test("treats query syntax as data but still blocks real path operands", () => {
  for (const command of [
    "jq -r '.key' package.json",
    `jq -r '.result.refs | to_entries[] | select(.value.role == "button") | .key' result.json`,
    "git config --get-regexp '^(gpg\\.ssh\\.|user\\.signingkey)$'",
    "rg -n 'process.env.NODE_ENV' src",
    "rg --files -g '!*.pem'",
    "rg -n 'deriveKey' packages/core/src/secret -g '*.ts'",
    "find . -maxdepth 2 -type f -name '.env' -o -name '*.pem' -o -name '*.key'",
  ]) {
    assert.equal(decideCommand(command).decision, "allow", command);
  }
  for (const command of ["cat client.key", "cat ~/.ssh/id_rsa", "git show HEAD:.env.production"]) {
    assert.equal(decideCommand(command).decision, "deny", command);
  }
  assert.equal(decideCommand("cat 'backups/client private.key'").decision, "deny");
  assert.equal(decideCommand("rg -n 'deriveKey' packages/core/src/secret").decision, "confirm");
  assert.equal(
    decideCommand("rg -n 'deriveKey' packages/core/src/secret -g '*'").decision,
    "confirm",
  );
  assert.equal(decideCommand("find . -name '.env' -exec cat {} \\;").decision, "deny");
  assert.equal(decideCommand("find . -name '.env' | xargs cat").decision, "deny");
});

test("checks apply_patch headers without treating patch contents as paths", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: src/config.ts\n@@\n+const example = '.env';\n*** End Patch",
      },
      cwd: process.cwd(),
    }).decision,
    "allow",
  );
  assert.equal(
    evaluatePolicy({
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: .env\n*** End Patch" },
      cwd: process.cwd(),
    }).decision,
    "deny",
  );
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

test("blocks clipboard reads without blocking clipboard writes", () => {
  for (const command of [
    "pbpaste",
    "/usr/bin/pbpaste",
    "command pbpaste",
    "wl-paste",
    "xclip -selection clipboard -o",
    "xsel --clipboard --output",
    "pwsh -Command Get-Clipboard",
    "osascript -e 'return the clipboard as text'",
    "osascript -e 'clipboard info'",
  ]) {
    assert.equal(decideCommand(command).ruleId, "clipboard-read", command);
  }

  for (const command of [
    "printf hello | pbcopy",
    "wl-copy hello",
    "osascript -e 'set the clipboard to \"hello\"'",
    "rg -n pbpaste src/",
  ]) {
    assert.equal(decideCommand(command).decision, "allow", command);
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

test("tells a public certificate from a private key by its name", () => {
  // Public trust material every TLS client reads.
  for (const command of [
    'adb shell "SSL_CERT_FILE=/mnt/sdcard/share/cacert.pem timeout 60 /tmp/cli refresh"',
    "curl --cacert /etc/ssl/ca-bundle.pem https://x.test",
    "openssl x509 -in fullchain.pem -noout -dates",
    "ls -la certs/cert.pem",
  ]) {
    assert.equal(decideCommand(command).decision, "allow", command);
  }
  // Anything else carrying the extension stays a key until proven otherwise.
  for (const command of ["cat server-privkey.pem", "cat id_rsa.pem", "cat client.key"]) {
    assert.equal(decideCommand(command).decision, "deny", command);
  }
});

test("separates a project rc file from the one in the home directory", () => {
  // The committed copy carries registry and mirror settings and is read often.
  for (const command of [
    'grep -n "postinstall" package.json .yarnrc.yml',
    'grep -rn "ELECTRON_MIRROR" .npmrc .yarnrc.yml',
    "cat packages/w/.npmrc",
  ]) {
    assert.equal(decideCommand(command).decision, "confirm", command);
  }
  // The copy in $HOME carries the auth token.
  for (const command of ["cat ~/.npmrc", "cat $HOME/.npmrc", "cat ~/.pypirc", "cat ~/.netrc"]) {
    assert.equal(decideCommand(command).decision, "deny", command);
  }
});

test("reads regex alternation inside an argument as text, not as a pipeline", () => {
  // The pipes in `grep -iE "init|<name>|filter"` belong to the pattern, not to
  // the shell, so the middle word is not its own command.
  const word = "e" + "nv";
  for (const command of [
    `grep -iE "init|${word}|filter" src/`,
    `grep -nE "def test|skip|${word}|get${word}|real" tests/x.py`,
    `ls -la .v${word}/bin/python*`,
  ]) {
    assert.equal(decideCommand(command).decision, "allow", command);
  }
  for (const command of [word, `${word} | grep -i TOKEN`, `print${word}`, "export -p"]) {
    assert.equal(decideCommand(command).ruleId, "process-environment-access", command);
  }
});

test("reads ps env-display flags without scanning past them", () => {
  for (const command of ["ps e", "ps aux e", "ps -E"]) {
    assert.equal(decideCommand(command).ruleId, "process-environment-access", command);
  }
  // A later argument holding a capital E is not the env-display flag.
  for (const command of ["ps -o pid,lstart,command -p 123", "ps aux | grep node", "ps -ef"]) {
    assert.equal(decideCommand(command).decision, "allow", command);
  }
});

test("judges a URL by its host, and skips one that is still a pattern", () => {
  // A loop leaves a variable where the port goes and a search leaves a
  // character class where the host goes; neither is a name to rule on.
  for (const command of [
    "curl -s http://127.0.0.1:6299$path",
    'curl -s "http://127.0.0.1:${port}/api"',
    `grep -aoE 'x="https://suite-sync[a-zA-Z0-9._/-]*"' file`,
    'grep -iE "http://|https://|cdn\\." src/',
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:6299; echo done',
    "adb reverse tcp:8443 tcp:8443",
  ]) {
    assert.equal(decideCommand(command).decision, "allow", command);
  }
  // A literal deceptive host is still refused.
  assert.equal(decideCommand("curl http://evil.agents.md/x").decision, "deny");
});
