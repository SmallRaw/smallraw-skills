"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  gh,
  safeName,
  validatePositiveInteger,
  validateRepo,
  yamlString,
} = require("../scripts/utils");

test("gh only accepts an argv string array", () => {
  assert.throws(() => gh("repo view octocat/Hello-World"), /array of strings/);
  assert.throws(() => gh(["repo", 42]), /array of strings/);
});

test("gh arguments cannot become shell commands", () => {
  const marker = path.join(os.tmpdir(), `github-kb-shell-injection-${process.pid}`);
  try {
    assert.throws(
      () => gh([`--version; touch ${marker}`]),
      (error) => error.name === "GitHubCliError"
    );
    assert.equal(fs.existsSync(marker), false);
  } finally {
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
  }
});

test("safeName is readable, deterministic, bounded, and collision resistant", () => {
  const first = safeName("记忆 系统");
  assert.match(first, /^记忆-系统-[a-f0-9]{8}$/u);
  assert.equal(first, safeName("记忆 系统"));
  assert.notEqual(first, safeName("知识 系统"));
  assert.notEqual(safeName("owner/repo"), safeName("owner-repo"));
  assert.ok(safeName("x".repeat(200)).length <= 57);
});

test("validateRepo accepts GitHub owner/repo names and rejects path injection", () => {
  assert.equal(validateRepo("facebook/react"), "facebook/react");
  assert.equal(validateRepo("octocat/.github"), "octocat/.github");
  for (const invalid of [
    "facebook/react/extra",
    "facebook/react?x=1",
    "facebook/react;touch-x",
    "-owner/repo",
    "owner/",
    "owner repo/name",
  ]) {
    assert.throws(() => validateRepo(invalid), /Invalid GitHub repository/);
  }
});

test("validatePositiveInteger rejects signs, zero, decimals, and command text", () => {
  assert.equal(validatePositiveInteger(12, "issue number"), "12");
  for (const invalid of [0, -1, "+2", "1.5", "1;echo-x", ""])
    assert.throws(() => validatePositiveInteger(invalid), /positive integer/);
});

test("yamlString keeps user text inside one YAML scalar", () => {
  assert.equal(yamlString('a"b\n---'), '"a\\\"b\\n---"');
});
