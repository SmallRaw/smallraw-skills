"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scriptsDir = path.resolve(__dirname, "../scripts");
const scriptFiles = fs
  .readdirSync(scriptsDir)
  .filter((name) => name.endsWith(".js"))
  .sort();

test("GitHub scripts never invoke a shell command string", () => {
  for (const file of scriptFiles) {
    const source = fs.readFileSync(path.join(scriptsDir, file), "utf8");
    assert.doesNotMatch(source, /\bexecSync\s*\(/, `${file} uses execSync`);
    assert.doesNotMatch(source, /\bshell\s*:\s*true/, `${file} enables shell execution`);
    assert.doesNotMatch(source, /\bgh\s*\(\s*[`'\"]/, `${file} passes a command string to gh()`);
  }
});

test("entry scripts validate repository input before GitHub calls", () => {
  for (const file of ["gh-repo-blueprint.js", "gh-digest.js", "gh-version-diff.js"]) {
    const source = fs.readFileSync(path.join(scriptsDir, file), "utf8");
    assert.match(source, /validateRepo\s*\(/, `${file} does not validate owner/repo input`);
  }
});

test("PR search uses the gh search merged filter", () => {
  const source = fs.readFileSync(path.join(scriptsDir, "gh-explore.js"), "utf8");
  assert.match(source, /"search",\s*"prs",[\s\S]*?"--merged"/);
  assert.doesNotMatch(source, /"search",\s*"prs",[\s\S]*?"--state",\s*"merged"/);
});
