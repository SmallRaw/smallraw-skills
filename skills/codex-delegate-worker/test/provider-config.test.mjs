import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { asProfiles, configurationStatus, createVault, loadWorkerConfig, makeProfileStore, readConfig, saveProfiles } from "../scripts/provider-config.mjs";
import { normalizeBaseUrl, runConfiguration, terminalLaunchSpec } from "../scripts/configure.mjs";
import { privateOutputStream, redactOutput } from "../scripts/private-output.mjs";

const launcher = fileURLToPath(new URL("../scripts/codex-delegate-worker.mjs", import.meta.url));
const sample = { baseUrl: "https://private-fixture.example.test/v1", model: "fixture-model", apiKey: "fixture-key-123" };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-config-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = { global: path.join(root, "global", "codex-delegate-worker.json"), local: path.join(root, ".codex-delegate-worker.json"), explicit: "" };
  const records = new Map();
  let next = 0;
  const vault = {
    write(config) { const credential = { type: "fixture", id: String(++next) }; records.set(credential.id, structuredClone(config)); return credential; },
    read(credential) { assert.ok(records.has(credential.id)); return structuredClone(records.get(credential.id)); },
    remove(credential) { records.delete(credential.id); },
  };
  return { root, paths, vault, records, store: makeProfileStore({ paths, vault }) };
}

test("Local overrides Global without inheriting another provider's credentials; deletion falls back", (t) => {
  const f = fixture(t);
  f.store.put("global", "shared", sample);
  f.store.put("local", "project", { baseUrl: "http://localhost:8000/v1", model: "local-model" });
  assert.equal(loadWorkerConfig(f).model, "local-model");
  assert.equal(loadWorkerConfig(f).apiKey, undefined);
  assert.deepEqual(configurationStatus(f.paths), { configured: true, local: true, global: true });
  f.store.remove("local", "project");
  assert.deepEqual(loadWorkerConfig(f), sample);
  assert.equal(f.records.size, 1);
});

test("add, replace, default selection, and deletion never write private values to metadata", (t) => {
  const f = fixture(t);
  f.store.put("global", "first", sample);
  f.store.put("global", "中文 / second", { ...sample, model: "second-model" });
  f.store.use("global", "中文 / second");
  assert.equal(loadWorkerConfig(f).model, "second-model");
  f.store.put("global", "中文 / second", { ...sample, apiKey: "replacement-key" });
  assert.equal(f.records.size, 2);
  assert.equal(loadWorkerConfig(f).apiKey, "replacement-key");
  const metadata = fs.readFileSync(f.paths.global, "utf8");
  for (const value of [...Object.values(sample), "replacement-key", "second-model"]) assert.ok(!metadata.includes(value));
  if (process.platform !== "win32") assert.equal(fs.statSync(f.paths.global).mode & 0o777, 0o600);
  f.store.remove("global", "first");
  f.store.remove("global", "中文 / second");
  assert.equal(f.records.size, 0);
  assert.deepEqual(configurationStatus(f.paths), { configured: false, local: false, global: false });
});

test("legacy flat configuration migrates through code into credential storage", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.paths.global), { recursive: true });
  fs.writeFileSync(f.paths.global, JSON.stringify(sample));
  f.store.migrate("global");
  assert.deepEqual(loadWorkerConfig(f), sample);
  assert.equal(f.records.size, 1);
  assert.ok(!fs.readFileSync(f.paths.global, "utf8").includes(sample.apiKey));
  f.store.migrate("global");
  assert.equal(f.records.size, 1);
});

test("earlier flat-config override precedence remains available", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.paths.global), { recursive: true });
  fs.writeFileSync(f.paths.global, JSON.stringify(sample));
  fs.writeFileSync(f.paths.local, JSON.stringify({ model: "project-model" }));
  assert.deepEqual(loadWorkerConfig(f), { ...sample, model: "project-model" });
});

for (const order of [["global", "local"], ["local", "global"]]) {
  test(`partial legacy overrides survive migration in ${order.join(" then ")} order`, (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.paths.global), { recursive: true });
    fs.writeFileSync(f.paths.global, JSON.stringify(sample));
    fs.writeFileSync(f.paths.local, JSON.stringify({ model: "project-model" }));
    for (const scope of order) f.store.migrate(scope);
    assert.deepEqual(loadWorkerConfig(f), { ...sample, model: "project-model" });
    assert.ok(!fs.readFileSync(f.paths.global, "utf8").includes(sample.apiKey));
    assert.ok(!fs.readFileSync(f.paths.local, "utf8").includes(sample.apiKey));
  });
}

test("provider-data write failure leaves metadata unchanged", (t) => {
  const f = fixture(t);
  const store = makeProfileStore({ paths: f.paths, vault: { write() { throw new Error("store unavailable"); } } });
  assert.throws(() => store.put("local", "test", sample), /store unavailable/);
  assert.equal(fs.existsSync(f.paths.local), false);
});

test("failed credential deletion restores the provider entry", (t) => {
  const f = fixture(t);
  f.store.put("global", "original", sample);
  const store = makeProfileStore({ paths: f.paths, vault: { ...f.vault, remove() { throw new Error("credential locked"); } } });
  assert.throws(() => store.remove("global", "original"), /credential locked/);
  assert.deepEqual(loadWorkerConfig(f), sample);
  assert.equal(f.store.read("global").defaultProvider, "original");
});

test("credential and malformed-config errors do not include helper output or input contents", (t) => {
  const f = fixture(t);
  const vault = createVault({ platform: "darwin", run: () => ({ status: 1, stderr: sample.apiKey, stdout: sample.baseUrl }) });
  assert.throws(() => vault.read({ type: "keychain", id: "fixture" }), (error) => !error.message.includes(sample.apiKey) && !error.message.includes(sample.baseUrl));
  fs.writeFileSync(f.paths.local, `{"broken":"${sample.apiKey}`);
  assert.throws(() => readConfig(f.paths.local), (error) => !error.message.includes(sample.apiKey));
});

for (const platform of ["darwin", "linux", "win32"]) {
  test(`${platform} private provider files need no system credential helper`, (t) => {
    const f = fixture(t);
    const directory = path.join(f.root, "provider-files");
    const vault = createVault({ directory, platform, run() { throw new Error("System credential helper must not be called"); } });
    const credential = vault.write(sample);
    assert.equal(credential.type, "file");
    assert.deepEqual(vault.read(credential), sample);
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 1);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(directory, files[0])).mode & 0o777, 0o600);
    }
    vault.remove(credential);
    assert.deepEqual(fs.readdirSync(directory), []);
  });
}

for (const [platform, credential] of [["darwin", {type:"keychain",id:"fixture"}], ["linux", {type:"secret-service",id:"fixture"}], ["win32", {type:"dpapi",data:"encrypted-fixture"}]]) {
  test(`${platform} earlier system-store references remain readable`, (t) => {
    const f = fixture(t);
    const vault = createVault({ directory: f.root, platform, run: () => ({status:0,stdout:JSON.stringify(sample)}) });
    assert.deepEqual(vault.read(credential), sample);
  });
}

test("provider file references cannot escape their storage directory", (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, "outside.json");
  fs.writeFileSync(outside, JSON.stringify(sample));
  const vault = createVault({ directory: path.join(f.root, "providers") });
  assert.throws(() => vault.read({ type: "file", id: "../outside" }), /unavailable/);
  vault.remove({ type: "file", id: "../outside" });
  assert.equal(fs.existsSync(outside), true);
});

test("private configuration menu supports both scopes and complete provider management", async (t) => {
  const f = fixture(t);
  const answers = [
    "1", "1", "personal", sample.baseUrl, sample.model, sample.apiKey,
    "5", "2", "1", "project", "http://localhost:8000/v1", "local-model", "",
    "1", "spare", "https://spare.example.test/v1", "spare-model", "spare-key",
    "4", "2", "2", "2", "https://edited.example.test/v1", "edited-model", "2", "edited-key",
    "3", "1", "y", "0",
  ];
  let output = "";
  let hiddenInputs = 0;
  await runConfiguration({ store: f.store, write: (value) => { output += value; }, ask: async (_label, options = {}) => {
    assert.ok(answers.length, "Unexpected extra question");
    if (options.secret) hiddenInputs += 1;
    return answers.shift();
  } });
  assert.equal(answers.length, 0);
  assert.equal(hiddenInputs, 4);
  assert.equal(f.store.read("global").defaultProvider, "personal");
  assert.equal(f.store.read("local").defaultProvider, "spare");
  assert.equal(loadWorkerConfig(f).apiKey, "edited-key");
  assert.equal(loadWorkerConfig(f).configMode, undefined);
  assert.equal(f.records.size, 2);
  assert.ok(!output.includes(sample.apiKey));
});

test("terminal launch specifications contain only program paths, scope, and working directory", () => {
  const options = { cwd: "/a path/with 'quote' and $(literal)", node: "/node path/node", script: "/skill path/worker.mjs", globalConfig: "/config path/worker.json", scope: "local" };
  const mac = terminalLaunchSpec({ ...options, platform: "darwin" });
  assert.equal(mac.command, "/usr/bin/osascript");
  assert.ok(mac.args[1].includes("configure"));
  assert.ok(mac.args[1].includes("--directory"));
  assert.ok(!JSON.stringify(mac).includes(sample.apiKey));
  const windows = terminalLaunchSpec({ ...options, platform: "win32" });
  assert.equal(windows.command, "powershell.exe");
  const script = Buffer.from(windows.args.at(-1), "base64").toString("utf16le");
  assert.ok(script.includes("Start-Process"));
  const linux = terminalLaunchSpec({ ...options, platform: "linux", find: (name) => name === "xterm" ? "/usr/bin/xterm" : undefined });
  assert.equal(linux.command, "/usr/bin/xterm");
  assert.ok(linux.args.includes(options.cwd));
  assert.throws(() => terminalLaunchSpec({ platform: "linux", find: () => undefined }), /No desktop terminal/);
});

test("native Codex terminal preserves every requested CLI argument", () => {
  const nativeArgs = ["resume", "--last", "--sandbox", "workspace-write"];
  const spec = terminalLaunchSpec({ platform: "linux", action: "native", nativeArgs, cwd: "/fixture", globalConfig: "/fixture-home/codex-delegate-worker.json", find: () => "/usr/bin/xterm" });
  assert.ok(spec.args.includes("_native-terminal"));
  assert.deepEqual(spec.args.slice(spec.args.indexOf("--") + 1), nativeArgs);
});

test("configuration refuses captured non-interactive input and status exposes only flags", (t) => {
  const f = fixture(t);
  f.store.put("local", "private-alias", sample);
  const env = { ...process.env, CODEX_HOME: path.dirname(f.paths.global), CODEX_DELEGATE_WORKER_CONFIG_FILE: "" };
  const status = spawnSync(process.execPath, [launcher, "status"], { cwd: f.root, env, encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout), { configured: true, local: true, global: false });
  const configure = spawnSync(process.execPath, [launcher, "configure"], { cwd: f.root, env, input: JSON.stringify(sample), encoding: "utf8" });
  assert.notEqual(configure.status, 0);
  assert.match(configure.stderr, /interactive terminal/);
  assert.ok(!configure.stdout.includes(sample.apiKey));
});

test("init help does not open a configuration window", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [launcher, "init", "--help"], { cwd: f.root, env: { ...process.env, CODEX_HOME: path.dirname(f.paths.global) }, encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test("a failed child launch remains sanitized and returns without hanging", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [launcher, "task"], {
    cwd: f.root,
    env: {
      ...process.env,
      CODEX_HOME: path.dirname(f.paths.global),
      CODEX_DELEGATE_WORKER_CONFIG_FILE: "",
      CODEX_DELEGATE_WORKER_BASE_URL: sample.baseUrl,
      CODEX_DELEGATE_WORKER_MODEL: sample.model,
      CODEX_DELEGATE_WORKER_API_KEY: sample.apiKey,
      CODEX_DELEGATE_WORKER_CODEX_BIN: path.join(f.root, `${sample.model}-missing`),
    },
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(result.status, 127, result.stderr);
  assert.ok(!result.stderr.includes(sample.model));
});

test("private output filters configured values, URL components, and encoded forms", () => {
  const redact = redactOutput(sample);
  const input = [sample.apiKey, sample.model, sample.baseUrl, "private-fixture.example.test", encodeURIComponent(sample.baseUrl), "task completed"].join("\n");
  const output = redact(input);
  for (const value of Object.values(sample)) assert.ok(!output.includes(value));
  assert.ok(!output.includes("private-fixture.example.test"));
  assert.ok(output.includes("task completed"));
});

test("private output remains private across byte boundaries and a final line without newline", async () => {
  const config = { ...sample, apiKey: "示例密钥-123" };
  const stream = privateOutputStream(config);
  let output = "";
  stream.on("data", (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => stream.on("end", resolve));
  const input = Buffer.from(`${config.apiKey}\n${config.baseUrl}\n${config.model}`);
  for (const byte of input) stream.write(Buffer.from([byte]));
  stream.end();
  await done;
  assert.equal(output, "[private]\n[private]\n[private]");
});

test("privacy filtering preserves native event types and session ids for short model aliases", async () => {
  const stream = privateOutputStream({ model: "a" });
  let output = "";
  stream.on("data", (chunk) => { output += chunk; });
  const done = new Promise((resolve) => stream.on("end", resolve));
  stream.end(JSON.stringify({ type: "thread.started", thread_id: "abcd-a123", item: { id: "item_a", type: "agent_message", text: "model a" } }) + "\n");
  await done;
  const event = JSON.parse(output);
  assert.equal(event.type, "thread.started");
  assert.equal(event.thread_id, "abcd-a123");
  assert.equal(event.item.id, "item_a");
  assert.equal(event.item.type, "agent_message");
  assert.equal(event.item.text, "model [private]");
});

test("URL input accepts local servers and normalizes a bare domain", () => {
  assert.equal(normalizeBaseUrl("http://localhost:8000/v1/"), "http://localhost:8000/v1");
  assert.equal(normalizeBaseUrl("provider.example.test/v1"), "https://provider.example.test/v1");
  assert.throws(() => normalizeBaseUrl("file:///tmp/config"));
});

test("empty metadata has no implicit default provider", (t) => {
  const f = fixture(t);
  saveProfiles(f.paths.local, asProfiles({}));
  assert.deepEqual(loadWorkerConfig(f), {});
  assert.equal(configurationStatus(f.paths).configured, false);
});
