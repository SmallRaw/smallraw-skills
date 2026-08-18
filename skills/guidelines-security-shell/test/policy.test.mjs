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
const cwd = process.cwd();

test("denies privilege escalation, disk destruction, and data shredding", () => {
  assert.equal(evaluateCommand("sudo rm -rf /tmp/x", cwd).ruleId, "privilege-escalation");
  assert.equal(evaluateCommand("make build && sudo make install", cwd).decision, "deny");
  assert.equal(evaluateCommand("shred -u notes.txt", cwd).decision, "deny");
  assert.equal(evaluateCommand("mkfs.ext4 /dev/sdb1", cwd).decision, "deny");
  assert.equal(evaluateCommand("dd if=image.iso of=/dev/disk2", cwd).ruleId, "disk-destruction");
  assert.equal(evaluateCommand("diskutil eraseDisk APFS Blank /dev/disk2", cwd).decision, "deny");
});

test("denies deleting system roots or the home directory itself", () => {
  assert.equal(evaluateCommand("rm -rf /", cwd).ruleId, "critical-root-deletion");
  assert.equal(evaluateCommand("rm -rf /*", cwd).decision, "deny");
  assert.equal(evaluateCommand("rm -rf ~", cwd).decision, "deny");
  assert.equal(evaluateCommand("rm -rf $HOME", cwd).decision, "deny");
  assert.equal(evaluateCommand("rm -rf /usr", cwd).decision, "deny");
  assert.equal(evaluateCommand("chmod -R 777 /etc", cwd).ruleId, "critical-root-permission-change");
});

test("allows workspace-internal cleanup but confirms outside or unknown scopes", () => {
  assert.equal(evaluateCommand("rm -rf node_modules dist", cwd).ruleId, "workspace-deletion");
  assert.equal(evaluateCommand("rm build/output.log", cwd).decision, "allow");
  assert.equal(evaluateCommand("rm -rf /tmp/scratch-dir", cwd).decision, "allow");
  assert.equal(evaluateCommand("chmod +x scripts/run.sh", cwd).decision, "allow");
  assert.equal(evaluateCommand("rmdir emptydir", cwd).decision, "allow");
  assert.equal(
    evaluateCommand("rm -rf ../other-project/dist", cwd).ruleId,
    "outside-workspace-deletion",
  );
  assert.equal(evaluateCommand("find . -name '*.tmp' | xargs rm -f", cwd).ruleId, "unknown-scope-deletion");
  assert.equal(evaluateCommand("chown admin ~/Library/LaunchAgents", cwd).decision, "confirm");
});

test("asks before an installer from another ecosystem fetches code", () => {
  for (const command of [
    "pip3 install --user git-filter-repo",
    "python3 -m pip install UnityPy Pillow",
    "uv pip install ruff",
    "cargo install cargo-xwin",
    "go install golang.org/x/tools/cmd/goimports@latest",
    "gem install bundler",
    "brew install llvm",
    "brew tap homebrew/cask",
    "apt-get install -y jq",
  ]) {
    assert.equal(evaluateCommand(command, cwd).ruleId, "foreign-package-install", command);
  }

  // Reading or listing is not fetching.
  for (const command of ["pip list", "brew --prefix lld", "cargo build", "go build ./...", "brew list"]) {
    assert.equal(evaluateCommand(command, cwd).decision, "allow", command);
  }
});

test("confirms process sweeps, container destruction, and publishing", () => {
  assert.equal(evaluateCommand("pkill -f 'node dev'", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("killall Dock", cwd).decision, "confirm");
  assert.equal(evaluateCommand("kill 12345", cwd).decision, "allow");
  assert.equal(evaluateCommand("docker rm -f app-container", cwd).ruleId, "container-destruction");
  assert.equal(evaluateCommand("docker system prune -a", cwd).decision, "confirm");
  assert.equal(evaluateCommand("docker ps -a", cwd).decision, "allow");
  assert.equal(evaluateCommand("twine upload dist/*", cwd).ruleId, "package-publish");
});

test("blocks shell indirection but allows running script files", () => {
  assert.equal(evaluateCommand("bash -c 'cat .env'", cwd).ruleId, "shell-indirection");
  assert.equal(evaluateCommand("zsh", cwd).decision, "deny");
  assert.equal(evaluateCommand("eval $PAYLOAD", cwd).decision, "deny");
  assert.equal(evaluateCommand("bash scripts/build.sh --release", cwd).ruleId, "script-execution");
  assert.equal(evaluateCommand("sh ./setup-dev.sh", cwd).decision, "allow");
});

test("sees through wrapper prefixes and shell chains", () => {
  assert.equal(evaluateCommand("nohup sudo reboot", cwd).decision, "deny");
  assert.equal(evaluateCommand("env FOO=1 rm -rf /usr", cwd).decision, "deny");
  assert.equal(evaluateCommand("timeout 30 pkill -f server", cwd).decision, "confirm");
  assert.equal(evaluateCommand("echo done; diskutil eraseVolume free none disk2", cwd).decision, "deny");
});

test("normalizes hook payloads and fails closed on malformed input", () => {
  assert.equal(
    evaluatePolicy({
      tool_name: "Bash",
      tool_input: { command: "rm -rf node_modules" },
      cwd,
    }).decision,
    "allow",
  );
  assert.equal(
    evaluatePolicy({ tool_name: "Read", tool_input: { file_path: "x" } }).decision,
    "allow",
  );
  assert.equal(evaluatePolicy(null).decision, "deny");
  assert.equal(evaluateCommand("rm -rf 'unclosed", cwd).ruleId, "ambiguous-shell-syntax");
});

test("allows sweeping own workspace or temp processes by path pattern", () => {
  assert.equal(
    evaluateCommand('pkill -f "harness/server.mjs" 2>/dev/null; echo done', cwd).decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("pkill -f /private/tmp/claude-501/session/scratchpad/server.mjs", cwd)
      .ruleId,
    "workspace-process-sweep",
  );
  // Bare names and paths outside the workspace reach anyone's processes.
  assert.equal(evaluateCommand("pkill -f node", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("pkill -f /usr/bin/node", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("killall Dock", cwd).decision, "confirm");
});

test("skips heredoc bodies but keeps live or unterminated ones visible", () => {
  assert.equal(
    evaluateCommand("python3 - <<'PY'\ns = \"it's fine\"\nprint(s)\nPY", cwd).decision,
    "allow",
  );
  // An unquoted delimiter may expand $() at run time; the body stays in view.
  assert.equal(
    evaluateCommand("cat <<EOF\n$(x) 'odd\nEOF", cwd).ruleId,
    "ambiguous-shell-syntax",
  );
  // No terminator line: nothing is stripped.
  assert.equal(
    evaluateCommand("cat <<'EOF'\nstill 'open", cwd).ruleId,
    "ambiguous-shell-syntax",
  );
  // Danger chained after the body is still seen.
  assert.equal(
    evaluateCommand("cat <<'EOF' > f\ndata's\nEOF\nsudo ls", cwd).ruleId,
    "privilege-escalation",
  );
});

test("CLI maps decisions to stable exit codes", () => {
  const cases = [
    ["ls -la", 0],
    ["pkill -f server", 1],
    ["sudo id", 2],
  ];
  for (const [command, status] of cases) {
    const run = spawnSync(process.execPath, [policyScript], {
      input: JSON.stringify({ kind: "command", target: command, cwd }),
      encoding: "utf8",
    });
    assert.equal(run.status, status, command);
    assert.ok(JSON.parse(run.stdout).decision, command);
  }
});

test("CLI runs and emits a verdict when invoked through a symlink", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shell-policy-link-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const link = path.join(root, "policy.mjs");
  fs.symlinkSync(policyScript, link);

  const run = spawnSync(process.execPath, [link], {
    input: JSON.stringify({ kind: "command", target: "sudo id", cwd }),
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ruleId, "privilege-escalation");
});
