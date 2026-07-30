import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const script = path.join(skillDir, "scripts", "preflight-lockfile.mjs");
const fixtures = path.join(testDir, "fixtures");
const baseline = path.join(fixtures, "baseline", "package-lock.json");

function runPreflight(fixtureName, extraArgs = []) {
  const fixtureDir = path.join(fixtures, fixtureName);
  return spawnSync(
    process.execPath,
    [
      script,
      "--manifest",
      path.join(fixtureDir, "package.json"),
      "--lockfile",
      path.join(fixtureDir, "package-lock.json"),
      "--baseline",
      baseline,
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        HOST_SECRET_SENTINEL: "must-not-be-needed",
      },
    },
  );
}

test("returns clear-for-next-gate when the dependency state is unchanged", () => {
  const result = runPreflight("unchanged");

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "clear-for-next-gate");
  assert.equal(report.code, "PREFLIGHT_CLEAR_FOR_NEXT_GATE");
  assert.match(report.nextAction, /not a safety verdict/);
  assert.equal(report.scope, "changed-lockfile-entries");
  assert.deepEqual(report.changes, {
    directSpecs: 0,
    addedOrChanged: 0,
    removed: 0,
    currentPackageCount: 1,
    baselinePackageCount: 1,
  });
  assert.deepEqual(report.findings, []);
  assert.equal(Object.hasOwn(report, "safe"), false);
});

test("routes only changed entries and reports mechanical risk signals", () => {
  const result = runPreflight("changed");

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.equal(report.status, "review-required");
  assert.equal(report.code, "PREFLIGHT_REVIEW_REQUIRED");
  assert.match(report.nextAction, /findings\[\]\.action/);
  assert.equal(report.changes.addedOrChanged, 2);
  assert.equal(codes.has("NON_EXACT_DIRECT_SPEC"), true);
  assert.equal(codes.has("INSECURE_SOURCE"), true);
  assert.equal(codes.has("UNAPPROVED_REGISTRY"), true);
  assert.equal(codes.has("MISSING_OR_WEAK_INTEGRITY"), true);
  assert.equal(codes.has("INSTALL_SCRIPT"), true);
  assert.equal(codes.has("PACKAGE_BINARY"), true);
  assert.equal(codes.has("TARBALL_PACKAGE_MISMATCH"), true);
  assert.equal(
    report.findings.every(
      (finding) => typeof finding.action === "string" && finding.action.length > 20,
    ),
    true,
  );
});

test("fails closed before reading an explicitly misnamed input", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--manifest",
      path.join(skillDir, "evals", "evals.json"),
      "--lockfile",
      path.join(fixtures, "unchanged", "package-lock.json"),
    ],
    {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
    },
  );

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "blocked-pending-review");
  assert.equal(report.error.code, "INPUT_UNEXPECTED_FILENAME");
  assert.match(report.error.message, /expected a file named package\.json/);
  assert.match(report.error.nextAction, /exact filename package\.json/);
  assert.equal(result.stderr, "");
});

test("returns structured usage and remediation for invalid CLI input", () => {
  const result = spawnSync(process.execPath, [script, "--unknown"], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
  });

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "blocked-pending-review");
  assert.equal(report.error.code, "CLI_UNKNOWN_ARGUMENT");
  assert.match(report.error.nextAction, /Remove the unknown flag/);
  assert.match(report.usage, /--manifest/);
  assert.equal(result.stderr, "");
});
