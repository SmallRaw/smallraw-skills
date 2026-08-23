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
    "cargo install cargo-xwin",
    "go install golang.org/x/tools/cmd/goimports@latest",
    "gem install bundler",
    "brew install llvm",
    "brew tap homebrew/cask",
    "apt-get install -y jq",
  ]) {
    assert.equal(evaluateCommand(command, cwd).ruleId, "foreign-package-install", command);
  }

  // pip is the one with a lever: a wheel is unpacked, a source distribution
  // runs its setup.py while installing. Name the spelling that closes it.
  for (const command of [
    "pip3 install --user git-filter-repo",
    "python3 -m pip install UnityPy Pillow",
    "uv pip install ruff",
  ]) {
    assert.equal(evaluateCommand(command, cwd).ruleId, "install-runs-package-code", command);
  }
  assert.equal(
    evaluateCommand("pip install --only-binary=:all: requests", cwd).ruleId,
    "foreign-package-install",
  );

  // Reading or listing is not fetching.
  for (const command of ["pip list", "brew --prefix lld", "cargo build", "go build ./...", "brew list"]) {
    assert.equal(evaluateCommand(command, cwd).decision, "allow", command);
  }
});

test("confirms process sweeps, volume loss, and publishing", () => {
  assert.equal(evaluateCommand("pkill -f 'node dev'", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("killall Dock", cwd).decision, "confirm");
  assert.equal(evaluateCommand("kill 12345", cwd).decision, "allow");
  assert.equal(evaluateCommand("twine upload dist/*", cwd).ruleId, "package-publish");

  // A volume is the only docker object holding data nothing else has a copy of.
  assert.equal(evaluateCommand("docker volume rm pgdata", cwd).ruleId, "volume-destruction");
  assert.equal(evaluateCommand("docker rm -v scratch", cwd).ruleId, "volume-destruction");
  assert.equal(evaluateCommand("docker system prune -a", cwd).ruleId, "container-sweep");
  // Containers and images are build products: a rerun or a rebuild restores them.
  assert.equal(evaluateCommand("docker rm -f app-container", cwd).decision, "allow");
  assert.equal(evaluateCommand("docker rmi smoke-test-image", cwd).decision, "allow");
  assert.equal(evaluateCommand("docker image prune -f", cwd).decision, "allow");
  assert.equal(evaluateCommand("docker ps -a", cwd).decision, "allow");
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

test("allows sweeping a process the pattern actually identifies", () => {
  assert.equal(
    evaluateCommand('pkill -f "harness/server.mjs" 2>/dev/null; echo done', cwd).decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("pkill -f /private/tmp/claude-501/session/scratchpad/server.mjs", cwd)
      .ruleId,
    "specific-process-match",
  );
  // A pattern with structure names one process: a script, a port, a flag
  // fragment, a hyphenated tool.
  for (const command of [
    "pkill -f run_server.py",
    'pkill -f "vite --port 6399"',
    "pkill -f agent-browser",
    "pkill -f remote-debugging-port=9333",
  ]) {
    assert.equal(evaluateCommand(command, cwd).decision, "allow", command);
  }
  // Naming an automation harness targets a driven process, not a person's session.
  for (const command of [
    "pkill -f Headless",
    'pkill -f "chrome --headless"',
    "pkill -9 -f 'Chrome for Testing'",
    "pkill -f user-data-dir=/var/folders",
  ]) {
    assert.equal(evaluateCommand(command, cwd).decision, "allow", command);
  }
  // A bare word, or a path to a shared interpreter, reaches anyone's processes.
  assert.equal(evaluateCommand("pkill -f node", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("pkill -f /usr/bin/node", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("pkill -f server", cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand('pkill -f "node --inspect"', cwd).ruleId, "process-sweep");
  assert.equal(evaluateCommand("killall Dock", cwd).decision, "confirm");
});

test("sees a write landing outside the workspace, not only a deletion", () => {
  // Overwriting destroys the contents as completely as removing the file, and
  // leaves the file there so nothing looks missing.
  const other = "/Users/someone/other-repo";
  for (const command of [
    `echo broken > ${other}/package.json`,
    `echo x >> ${other}/.gitignore`,
    `cp ./bad.ts ${other}/src/index.ts`,
    `mv ./bad.ts ${other}/src/index.ts`,
    `sed -i '' 's/a/b/g' ${other}/package.json`,
    `echo x | tee ${other}/package.json`,
    `tar xzf pkg.tgz -C ${other}`,
    `rsync -a ./src/ ${other}/src/`,
    `cat > ${other}/package.json`,
    "echo x > ~/.zshrc",
  ]) {
    assert.equal(evaluateCommand(command, cwd).ruleId, "outside-workspace-write", command);
  }
  // Writing where the work is, and reading anywhere, stay out of the way.
  for (const command of [
    "echo x > build/out.log",
    "echo x > /tmp/scratch.txt",
    "cp a.ts b.ts",
    "node build.js 2>/dev/null",
    "node build.js > /dev/null 2>&1",
    "ls -la 2>&1 | head",
    `cat ${other}/package.json`,
    `grep -rn TODO ${other}/src`,
    "sed -n '1,5p' package.json",
  ]) {
    assert.equal(evaluateCommand(command, cwd).decision, "allow", command);
  }
});

test("reads ordinary shell syntax instead of calling it ambiguous", () => {
  // A line continuation is removed by the shell; leaving the backslash stranded
  // at a segment boundary read as unfinished input.
  assert.equal(
    evaluateCommand('git diff -U0 a.ts \\\n | grep -E "^[+-]" \\\n | head', cwd).decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("for p in \\\n  a.ts \\\n  b.ts \\\n  ; do echo $p; done", cwd).decision,
    "allow",
  );
  // Prose in a comment carries apostrophes.
  assert.equal(
    evaluateCommand("# simulate Dockerfile's build context\nls -la", cwd).decision,
    "allow",
  );
  assert.equal(evaluateCommand("ls # keep the user's copy", cwd).decision, "allow");
  // A substitution quotes independently of the text around it.
  assert.equal(evaluateCommand(`echo "$(grep -c '^"@x/' f)"`, cwd).decision, "allow");
  // Genuinely unfinished input still reads as unfinished.
  assert.equal(evaluateCommand("rm -rf 'unclosed", cwd).ruleId, "ambiguous-shell-syntax");
});

test("follows cd so relative paths are judged where the shell stands", () => {
  assert.equal(evaluateCommand("cd /etc && rm -rf .", cwd).ruleId, "critical-root-deletion");
  assert.equal(
    evaluateCommand("cd /Users/someone/other-repo && rm -rf packages/thing", cwd).ruleId,
    "outside-workspace-deletion",
  );
  // A path parked in a literal variable is still a readable path.
  assert.equal(
    evaluateCommand("S=/private/tmp/scratch; cd $S/work && rm -f ../out.zip", cwd).decision,
    "allow",
  );
  assert.equal(evaluateCommand("cd $UNKNOWN && rm -rf build", cwd).ruleId, "unknown-scope-deletion");
});

test("sees deletion through find and through an unexpanded target", () => {
  assert.equal(evaluateCommand("find / -name '*.log' -delete", cwd).ruleId, "critical-root-deletion");
  assert.equal(
    evaluateCommand("find ~/Library -name x -exec rm -f {} +", cwd).ruleId,
    "outside-workspace-deletion",
  );
  assert.equal(evaluateCommand("find . -name '*.tmp' -delete", cwd).decision, "allow");
  assert.equal(evaluateCommand("find . -name '*.ts' -exec cat {} +", cwd).decision, "allow");
  assert.equal(evaluateCommand("rm -rf $(cat targets.txt)", cwd).ruleId, "unknown-scope-deletion");
});

test("gates a permission change by what it does, not only where it lands", () => {
  // Flipping one file executable costs nothing and undoes itself.
  assert.equal(
    evaluateCommand("cd /Users/someone/other-repo && chmod +x build.sh", cwd).decision,
    "allow",
  );
  assert.equal(
    evaluateCommand("chmod -R 755 /Users/someone/other-repo/dist", cwd).ruleId,
    "outside-workspace-permission-change",
  );
  assert.equal(evaluateCommand("chown admin ~/Library/LaunchAgents", cwd).decision, "confirm");
});

test("treats dd by where it writes", () => {
  assert.equal(evaluateCommand("dd if=disk.img | hexdump -C | head", cwd).decision, "allow");
  assert.equal(evaluateCommand("dd if=/dev/zero of=/tmp/big.img bs=1m count=8", cwd).decision, "allow");
  assert.equal(evaluateCommand("dd if=/dev/zero of=out.img bs=1m count=8", cwd).decision, "allow");
  assert.equal(evaluateCommand("dd if=x of=/Users/someone/notes.txt", cwd).ruleId, "raw-copy");
  assert.equal(evaluateCommand("dd if=image.iso of=/dev/disk2", cwd).ruleId, "disk-destruction");
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
