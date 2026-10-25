import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const launcher = fileURLToPath(new URL("../scripts/codex-delegate-worker.mjs", import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-native-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  fs.mkdirSync(codexHome);
  const capturePath = path.join(root, "capture.json");
  const fakeScript = path.join(root, "fake-codex.mjs");
  fs.writeFileSync(fakeScript, `import fs from "node:fs";
import path from "node:path";
const configPath = path.join(process.env.CODEX_HOME, "config.toml");
fs.writeFileSync(process.env.CODEX_DELEGATE_WORKER_CAPTURE_PATH, JSON.stringify({
  args: process.argv.slice(2), codeHome: process.env.CODEX_HOME,
  apiKey: process.env.CODEX_DELEGATE_WORKER_API_KEY,
  hasApiKeyEnv: Object.hasOwn(process.env, "CODEX_DELEGATE_WORKER_API_KEY"),
  config: fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "",
}));
fs.mkdirSync(path.join(process.env.CODEX_HOME, "sessions"), {recursive:true});
fs.writeFileSync(path.join(process.env.CODEX_HOME, "sessions", "fixture.json"), "saved");
const output = process.env.CODEX_DELEGATE_WORKER_TEST_OUTPUT;
if (output) {
  process.stdout.write(output.slice(0, 7));
  process.stderr.write(output.slice(0, 9));
  setTimeout(() => { process.stdout.write(output.slice(7)); process.stderr.write(output.slice(9)); }, 5);
}
`);
  const fakeCodex = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");
  if (process.platform === "win32") fs.writeFileSync(fakeCodex, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`);
  else fs.writeFileSync(fakeCodex, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fakeScript.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("CODEX_DELEGATE_WORKER_")) delete env[key];
  Object.assign(env, {
    CODEX_HOME: codexHome,
    CODEX_DELEGATE_WORKER_CODEX_BIN: fakeCodex,
    CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
    CODEX_DELEGATE_WORKER_BASE_URL: "https://synthetic-node.example.test/v1",
    CODEX_DELEGATE_WORKER_MODEL: "gpt-synthetic-alias",
    CODEX_DELEGATE_WORKER_API_KEY: "synthetic-key-only",
  });
  return {
    root, codexHome, env, capturePath,
    run(args, overrides = {}) { return spawnSync(process.execPath, [launcher, ...args], { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000 }); },
    capture() { return JSON.parse(fs.readFileSync(capturePath, "utf8")); },
  };
}

function nativeTail(capture, command) {
  return capture.args.slice(capture.args.indexOf(command));
}

test("inherits normal Codex home and leaves configuration and saved sessions intact", (t) => {
  const f = fixture(t);
  const config = 'sandbox_mode="workspace-write"\napproval_policy="on-request"\n[features]\nmulti_agent=true\n[mcp_servers.fixture]\ncommand="fixture-mcp"\n';
  const configPath = path.join(f.codexHome, "config.toml");
  fs.writeFileSync(configPath, config);
  const result = f.run(["edit this project"]);
  assert.equal(result.status, 0, result.stderr);
  const capture = f.capture();
  assert.equal(capture.codeHome, f.codexHome);
  assert.equal(capture.config, config);
  assert.equal(fs.readFileSync(configPath, "utf8"), config);
  assert.equal(fs.readFileSync(path.join(f.codexHome, "sessions", "fixture.json"), "utf8"), "saved");
  assert.deepEqual(nativeTail(capture, "exec"), ["exec", "--skip-git-repo-check", "edit this project"]);
  assert.ok(!capture.args.includes("--ephemeral"));
  assert.ok(!capture.args.some((arg) => /sandbox_mode|approval_policy|default_permissions|shell_environment_policy|ignore-user-config|ignore-rules/.test(arg)));
});

for (const sandbox of ["read-only", "workspace-write", "danger-full-access"]) {
  test(`forwards an explicitly selected native ${sandbox} mode`, (t) => {
    const f = fixture(t);
    const result = f.run(["--sandbox", sandbox, "task"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(nativeTail(f.capture(), "exec"), ["exec", "--skip-git-repo-check", "--sandbox", sandbox, "task"]);
  });
}

for (const args of [
  ["exec", "resume", "--last", "--json"],
  ["--profile", "personal", "review", "--uncommitted"],
  ["fork", "session-id", "--model", "any-model-alias"],
  ["exec", "--worktree", "--add-dir", "/another project", "--image", "fixture.png", "task"],
  ["features", "list"],
  ["--help"],
]) {
  test(`native pass-through preserves ${args.join(" ")}`, (t) => {
    const f = fixture(t);
    const result = f.run(["--", ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.capture().args.slice(-args.length), args);
  });
}

test("ephemeral operation is available only when explicitly requested", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["--ephemeral", "task"]).status, 0);
  assert.equal(f.capture().args.filter((arg) => arg === "--ephemeral").length, 1);
});

test("old temporary-home and wire settings no longer change runtime or reject launch", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, ".codex-delegate-worker.json"), JSON.stringify({ configMode: "obsolete", keepHome: "0", wireApi: "chat", wire_api: "responses" }));
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_CONFIG_MODE: "temp-home", CODEX_DELEGATE_WORKER_KEEP_HOME: "0", CODEX_DELEGATE_WORKER_WIRE_API: "chat" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.capture().codeHome, f.codexHome);
  assert.ok(!f.capture().args.some((arg) => /wire_api|configMode|keepHome/.test(arg)));
});

test("accepts arbitrary provider labels through a stable internal id", (t) => {
  const f = fixture(t);
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_PROVIDER_ID: "custom/node.name" });
  assert.equal(result.status, 0, result.stderr);
  const id = `custom_${Buffer.from("custom/node.name").toString("base64url")}`;
  assert.ok(f.capture().args.includes(`model_provider="${id}"`));
  assert.ok(f.capture().args.includes(`model_providers.${id}.base_url="https://synthetic-node.example.test/v1"`));
});

test("no-auth nodes do not acquire a mandatory key requirement", (t) => {
  const f = fixture(t);
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_API_KEY: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.capture().hasApiKeyEnv, false);
  assert.ok(!f.capture().args.some((arg) => arg.includes("env_key=")));
});

test("command-backed authentication is forwarded without changing unrelated shell policy", (t) => {
  const f = fixture(t);
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_API_KEY: "", CODEX_DELEGATE_WORKER_AUTH_COMMAND: "fixture-helper", CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON: '["read","fixture-reference"]' });
  assert.equal(result.status, 0, result.stderr);
  const capture = f.capture();
  assert.ok(capture.args.some((arg) => arg.endsWith('auth.command="fixture-helper"')));
  assert.ok(!capture.args.some((arg) => /shell_environment_policy|env_key=/.test(arg)));
});

test("legacy global and local provider configuration retains local precedence", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.codexHome, "codex-delegate-worker.json"), JSON.stringify({ baseUrl: "https://global.example.test/v1", model: "global-model" }));
  fs.writeFileSync(path.join(f.root, ".codex-delegate-worker.json"), JSON.stringify({ model: "local-model" }));
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_BASE_URL: "", CODEX_DELEGATE_WORKER_MODEL: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(f.capture().args.includes('model="local-model"'));
  assert.ok(f.capture().args.some((arg) => arg.endsWith('.base_url="https://global.example.test/v1"')));
});

test("model overrides remain native arguments without a provider-name blacklist", (t) => {
  const f = fixture(t);
  const args = ["-m", "openai/synthetic-model", "-c", 'model="another-alias"', "task"];
  assert.equal(f.run(args).status, 0);
  assert.deepEqual(f.capture().args.slice(-args.length), args);
});

test("the explicit skip-Git option is not duplicated", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["--skip-git-repo-check", "task"]).status, 0);
  assert.equal(f.capture().args.filter((arg) => arg === "--skip-git-repo-check").length, 1);
});

test("privacy filtering survives native config inheritance and split child output", (t) => {
  const f = fixture(t);
  const privateValues = [f.env.CODEX_DELEGATE_WORKER_API_KEY, f.env.CODEX_DELEGATE_WORKER_BASE_URL, f.env.CODEX_DELEGATE_WORKER_MODEL];
  const result = f.run(["task"], { CODEX_DELEGATE_WORKER_TEST_OUTPUT: `Result: ${privateValues.join(" ")}\nfinished` });
  assert.equal(result.status, 0, result.stderr);
  for (const value of privateValues) {
    assert.ok(!result.stdout.includes(value));
    assert.ok(!result.stderr.includes(value));
  }
  assert.ok(result.stdout.includes("finished"));
});

test("native terminal execution restores the caller's real home and forwards session commands", (t) => {
  const f = fixture(t);
  const result = f.run(["_native-terminal", "--directory", f.root, "--global-config", path.join(f.codexHome, "codex-delegate-worker.json"), "--", "resume", "--last"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.capture().codeHome, f.codexHome);
  assert.deepEqual(f.capture().args.slice(-2), ["resume", "--last"]);
});

test("direct interactive mode keeps private terminal output outside captured automation", (t) => {
  const f = fixture(t);
  const result = f.run(["interactive"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /own terminal/);
  assert.equal(fs.existsSync(f.capturePath), false);
});
