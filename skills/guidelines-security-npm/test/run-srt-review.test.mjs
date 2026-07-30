import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const launcher = path.join(skillDir, "scripts", "run-srt-review.mjs");

function makeHarness(targetName = "target", srtVersion = "9.8.7") {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "npm-srt-launcher-test-")),
  );
  const packageRoot = path.join(root, "sandbox-runtime");
  const distDir = path.join(packageRoot, "dist");
  const workdir = path.join(root, "quarantine");
  const evidenceDir = path.join(root, "evidence");
  const target = path.join(workdir, targetName);
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(workdir);
  fs.mkdirSync(evidenceDir);
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@anthropic-ai/sandbox-runtime",
      version: srtVersion,
      type: "module",
    }),
  );
  fs.writeFileSync(target, "");

  const cliPath = path.join(distDir, "cli.js");
  fs.writeFileSync(
    cliPath,
    `import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const targetArgs = args.slice(separator + 1);
if (path.basename(targetArgs[0]) === "srt-bootstrap-failure") {
  process.exit(73);
}
fs.writeFileSync(path.join(process.cwd(), "capture.json"), JSON.stringify({
  args,
  targetArgs,
  env: process.env
}, null, 2));
if (path.basename(targetArgs[0]) === "timeout-target") {
  setInterval(() => {}, 1000);
} else if (path.basename(targetArgs[0]) === "output-target") {
  process.stdout.write("x".repeat(4096));
}
`,
  );
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(cliPath))
    .digest("hex");
  return {
    root,
    packageRoot,
    workdir,
    evidenceDir,
    target,
    digest,
    srtVersion,
  };
}

function runLauncher(harness, extraOptions = [], targetArgs = []) {
  return spawnSync(
    process.execPath,
    [
      launcher,
      "--node",
      process.execPath,
      "--srt-package-root",
      harness.packageRoot,
      "--expected-srt-version",
      harness.srtVersion,
      "--expected-srt-sha256",
      harness.digest,
      "--workdir",
      harness.workdir,
      "--evidence-dir",
      harness.evidenceDir,
      ...extraOptions,
      "--",
      harness.target,
      ...targetArgs,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        HOST_SECRET_SENTINEL: "must-not-leak",
      },
      timeout: 5_000,
    },
  );
}

test("uses explicit SRT policy, argv, and a non-inherited environment", () => {
  const harness = makeHarness();
  const result = runLauncher(harness, [], ["argument with spaces", "--settings"]);

  assert.equal(result.status, 0, result.stderr);
  const capture = JSON.parse(
    fs.readFileSync(path.join(harness.workdir, "capture.json"), "utf8"),
  );
  assert.deepEqual(capture.targetArgs, [
    harness.target,
    "argument with spaces",
    "--settings",
  ]);
  assert.equal(Object.hasOwn(capture.env, "HOST_SECRET_SENTINEL"), false);
  const permittedEnvironmentKeys = new Set([
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "TMPDIR",
    "__CF_USER_TEXT_ENCODING",
  ]);
  assert.deepEqual(
    Object.keys(capture.env).filter((key) => !permittedEnvironmentKeys.has(key)),
    [],
  );

  const summary = JSON.parse(result.stdout);
  const evidence = JSON.parse(fs.readFileSync(summary.result, "utf8"));
  assert.equal(summary.code, "SRT_RUN_COMPLETED");
  assert.match(summary.nextAction, /Do not describe the target as safe/);
  assert.equal(evidence.code, "SRT_RUN_COMPLETED");
  assert.equal(evidence.nextAction, summary.nextAction);
  const policy = JSON.parse(fs.readFileSync(evidence.evidence.policy, "utf8"));
  assert.deepEqual(policy.network.allowedDomains, []);
  assert.deepEqual(policy.network.deniedDomains, ["*"]);
  assert.equal(policy.network.allowAllUnixSockets, false);
  assert.equal(policy.allowAppleEvents, false);
  assert.equal(policy.enableWeakerNetworkIsolation, false);
  assert.deepEqual(policy.filesystem.allowWrite, [harness.workdir]);
  assert.equal(policy.filesystem.denyRead.includes(harness.evidenceDir), true);
  assert.equal(policy.filesystem.denyWrite.includes(harness.evidenceDir), true);
});

test("fails closed before launch when the reviewed SRT digest does not match", () => {
  const harness = makeHarness();
  harness.digest = "0".repeat(64);
  const result = runLauncher(harness);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "SRT_DIGEST_MISMATCH");
  assert.match(report.error.nextAction, /only after reviewing/);
  assert.equal(result.stderr, "");
  assert.equal(fs.existsSync(path.join(harness.workdir, "capture.json")), false);
  assert.deepEqual(fs.readdirSync(harness.evidenceDir), []);
});

test("rejects SRT versions from before required sandbox fixes", () => {
  const harness = makeHarness("target", "0.0.49");
  const result = runLauncher(harness);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "SRT_VERSION_TOO_OLD");
  assert.match(report.error.nextAction, /do not bypass/);
  assert.deepEqual(fs.readdirSync(harness.evidenceDir), []);
});

test("rejects target commands outside the writable quarantine", () => {
  const harness = makeHarness();
  harness.target = "/usr/bin/true";
  const result = runLauncher(harness);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "TARGET_OUTSIDE_QUARANTINE");
  assert.match(report.error.nextAction, /inside quarantine/);
  assert.deepEqual(fs.readdirSync(harness.evidenceDir), []);
});

test("rejects a trusted read path that would expose the evidence directory", () => {
  const harness = makeHarness();
  const result = runLauncher(harness, ["--runtime-bin-dir", harness.root]);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "RUNTIME_BIN_OVERLAP");
  assert.match(report.error.nextAction, /external bin directory/);
  assert.deepEqual(fs.readdirSync(harness.evidenceDir), []);
});

test("fails closed when a reserved sandbox path is a dangling symlink", () => {
  const harness = makeHarness();
  fs.symlinkSync(
    path.join(harness.root, "outside-home"),
    path.join(harness.workdir, ".srt-home"),
  );
  const result = runLauncher(harness);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "RESERVED_SANDBOX_PATH_EXISTS");
  assert.match(report.error.nextAction, /Do not delete or reuse/);
  assert.equal(fs.existsSync(path.join(harness.root, "outside-home")), false);
  assert.deepEqual(fs.readdirSync(harness.evidenceDir), []);
});

test("kills a sandbox process that exceeds the wall-clock limit", () => {
  const harness = makeHarness("timeout-target");
  const result = runLauncher(harness, ["--timeout-ms", "150"]);

  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(result.stdout);
  const evidence = JSON.parse(fs.readFileSync(summary.result, "utf8"));
  assert.equal(summary.status, "timeout");
  assert.equal(summary.code, "TARGET_TIMEOUT");
  assert.match(summary.nextAction, /stronger resource boundary/);
  assert.equal(evidence.status, "timeout");
});

test("kills a sandbox process that floods captured output", () => {
  const harness = makeHarness("output-target");
  const result = runLauncher(harness, ["--max-output-bytes", "128"]);

  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(result.stdout);
  const evidence = JSON.parse(fs.readFileSync(summary.result, "utf8"));
  assert.equal(summary.status, "output-limit");
  assert.equal(summary.code, "TARGET_OUTPUT_LIMIT");
  assert.match(summary.nextAction, /Do not raise the limit/);
  assert.equal(evidence.capturedBytes.stdout, 128);
  assert.equal(fs.statSync(evidence.evidence.stdout).size, 128);
});

test("blocks when a nonzero SRT exit cannot be attributed to the target", () => {
  const harness = makeHarness("srt-bootstrap-failure");
  const result = runLauncher(harness);

  assert.equal(result.status, 2, result.stderr);
  const summary = JSON.parse(result.stdout);
  const evidence = JSON.parse(fs.readFileSync(summary.result, "utf8"));
  assert.equal(summary.status, "blocked-pending-review");
  assert.equal(summary.code, "SRT_OR_TARGET_EXIT_NONZERO");
  assert.match(summary.nextAction, /cannot prove whether SRT failed/);
  assert.equal(evidence.exitCode, 73);
  assert.equal(fs.existsSync(path.join(harness.workdir, "capture.json")), false);
});

test("returns structured usage when the target separator is missing", () => {
  const result = spawnSync(process.execPath, [launcher], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
  });

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "CLI_MISSING_COMMAND_SEPARATOR");
  assert.match(report.error.nextAction, /Add --/);
  assert.match(report.usage, /--expected-srt-sha256/);
  assert.equal(result.stderr, "");
});
