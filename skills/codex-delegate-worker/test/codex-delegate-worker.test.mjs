import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, "..");
const launcher = path.join(skillDir, "scripts", "codex-delegate-worker.mjs");

function runNode(args, env, options = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith("CODEX_DELEGATE_WORKER_")) {
        delete childEnv[key];
      }
    }
    delete childEnv.CODEX_HOME;
    if (!Object.prototype.hasOwnProperty.call(env, "CODEX_HOME")) {
      childEnv.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-home-"));
    }

    const child = spawn(process.execPath, args, {
      cwd: options.cwd ?? skillDir,
      env: { ...childEnv, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function makeFakeCodex(tmpdir) {
  const fakeCodex = path.join(tmpdir, process.platform === "win32" ? "codex.cmd" : "codex");
  const capturePath = path.join(tmpdir, "capture.json");

  if (process.platform === "win32") {
    fs.writeFileSync(
      fakeCodex,
      `@echo off\r\n"${process.execPath}" "${path.join(tmpdir, "fake-codex.mjs")}" %*\r\n`,
    );
  } else {
    fs.writeFileSync(
      fakeCodex,
      `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const configPath = path.join(process.env.CODEX_HOME, "config.toml");
fs.writeFileSync(process.env.CODEX_DELEGATE_WORKER_CAPTURE_PATH, JSON.stringify({
  args: process.argv.slice(2),
  codeHome: process.env.CODEX_HOME,
  apiKey: process.env.CODEX_DELEGATE_WORKER_API_KEY,
  hasApiKeyEnv: Object.prototype.hasOwnProperty.call(process.env, "CODEX_DELEGATE_WORKER_API_KEY"),
  config: fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : ""
}, null, 2));
`,
      { mode: 0o755 },
    );
  }

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(tmpdir, "fake-codex.mjs"),
`import fs from "node:fs";
import path from "node:path";
const configPath = path.join(process.env.CODEX_HOME, "config.toml");
fs.writeFileSync(process.env.CODEX_DELEGATE_WORKER_CAPTURE_PATH, JSON.stringify({
  args: process.argv.slice(2),
  codeHome: process.env.CODEX_HOME,
  apiKey: process.env.CODEX_DELEGATE_WORKER_API_KEY,
  hasApiKeyEnv: Object.prototype.hasOwnProperty.call(process.env, "CODEX_DELEGATE_WORKER_API_KEY"),
  config: fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : ""
}, null, 2));
`,
    );
  }

  return { fakeCodex, capturePath };
}

test("launches codex exec with a temporary namespaced provider config", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    const result = await runNode(
      [
        launcher,
        "--sandbox",
        "read-only",
        "summarize the repo",
      ],
      {
        CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
        CODEX_DELEGATE_WORKER_CODEX_BIN: fakeCodex,
        CODEX_DELEGATE_WORKER_CONFIG_MODE: "temp-home",
        CODEX_DELEGATE_WORKER_BASE_URL: "https://kapi.example.test/v1",
        CODEX_DELEGATE_WORKER_API_KEY: "test-key",
        CODEX_DELEGATE_WORKER_MODEL: "deepseek-flash",
        CODEX_DELEGATE_WORKER_PROVIDER_ID: "kapi_deepseek",
        CODEX_DELEGATE_WORKER_PROVIDER_NAME: "Xiaoqiang KAPI worker",
      },
    );

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));

    assert.deepEqual(capture.args, [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "summarize the repo",
    ]);
    assert.equal(capture.apiKey, "test-key");
    assert.match(capture.codeHome, /codex-delegate-worker-/);
    assert.match(capture.config, /model = "deepseek-flash"/);
    assert.match(capture.config, /model_provider = "kapi_deepseek"/);
    assert.match(capture.config, /\[model_providers\.kapi_deepseek\]/);
    assert.match(capture.config, /name = "Xiaoqiang KAPI worker"/);
    assert.match(capture.config, /base_url = "https:\/\/kapi\.example\.test\/v1"/);
    assert.match(capture.config, /env_key = "CODEX_DELEGATE_WORKER_API_KEY"/);
    assert.match(capture.config, /\[shell_environment_policy\]/);
    assert.match(capture.config, /exclude = \["CODEX_DELEGATE_WORKER_API_KEY"\]/);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("fails before spawning codex when the skill-scoped API key is missing", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    const result = await runNode([launcher, "do work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_CODEX_BIN: fakeCodex,
      CODEX_DELEGATE_WORKER_CONFIG_MODE: "temp-home",
      CODEX_DELEGATE_WORKER_BASE_URL: "https://kapi.example.test/v1",
      CODEX_DELEGATE_WORKER_API_KEY: "",
    });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /missing CODEX_DELEGATE_WORKER_API_KEY/);
    assert.equal(fs.existsSync(capturePath), false);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("writes command-backed auth config without requiring an API key env var", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    const result = await runNode([launcher, "do work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_CODEX_BIN: fakeCodex,
      CODEX_DELEGATE_WORKER_CONFIG_MODE: "temp-home",
      CODEX_DELEGATE_WORKER_BASE_URL: "https://kapi.example.test/v1",
      CODEX_DELEGATE_WORKER_API_KEY: "",
      CODEX_DELEGATE_WORKER_AUTH_COMMAND: "op",
      CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON: JSON.stringify([
        "read",
        "op://Private/KAPI API Key/credential",
      ]),
    });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));

    assert.match(capture.config, /\[model_providers\.codex_delegate_worker\.auth\]/);
    assert.match(capture.config, /command = "op"/);
    assert.match(capture.config, /args = \["read", "op:\/\/Private\/KAPI API Key\/credential"\]/);
    assert.doesNotMatch(capture.config, /env_key/);
    assert.equal(capture.hasApiKeyEnv, false);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("reads local config file from the current working directory", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    fs.writeFileSync(
      path.join(tmpdir, ".codex-delegate-worker.json"),
      JSON.stringify({
        baseUrl: "https://local-config.example.test/v1",
        configMode: "temp-home",
        model: "local-config-model",
        providerId: "local_config_provider",
        providerName: "Local config provider",
        codexBin: fakeCodex,
        auth: {
          command: "op",
          args: ["read", "op://Private/Local Provider/credential"],
        },
      }),
    );

    const result = await runNode([launcher, "do work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_API_KEY: "",
    }, { cwd: tmpdir });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.match(capture.config, /model = "local-config-model"/);
    assert.match(capture.config, /model_provider = "local_config_provider"/);
    assert.match(capture.config, /base_url = "https:\/\/local-config\.example\.test\/v1"/);
    assert.match(capture.config, /command = "op"/);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("reads global config from CODEX_HOME when no local config exists", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    const codexHome = path.join(tmpdir, "codex-home");
    const workdir = path.join(tmpdir, "workdir");
    fs.mkdirSync(codexHome);
    fs.mkdirSync(workdir);
    fs.writeFileSync(
      path.join(codexHome, "codex-delegate-worker.json"),
      JSON.stringify({
        baseUrl: "https://global-config.example.test/v1",
        configMode: "temp-home",
        model: "global-config-model",
        codexBin: fakeCodex,
        auth: {
          command: "bw",
          args: ["get", "password", "Provider API Key"],
        },
      }),
    );

    const result = await runNode([launcher, "do work"], {
      CODEX_HOME: codexHome,
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_API_KEY: "",
    }, { cwd: workdir });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.match(capture.config, /model = "global-config-model"/);
    assert.match(capture.config, /base_url = "https:\/\/global-config\.example\.test\/v1"/);
    assert.match(capture.config, /command = "bw"/);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("reads direct apiKey from config without writing the secret to temporary Codex config", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    fs.writeFileSync(
      path.join(tmpdir, ".codex-delegate-worker.json"),
      JSON.stringify({
        baseUrl: "https://direct-key.example.test/v1",
        configMode: "temp-home",
        model: "direct-key-model",
        codexBin: fakeCodex,
        apiKey: "secret-from-json",
      }),
    );

    const result = await runNode([launcher, "do work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_API_KEY: "",
    }, { cwd: tmpdir });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.equal(capture.apiKey, "secret-from-json");
    assert.match(capture.config, /env_key = "CODEX_DELEGATE_WORKER_API_KEY"/);
    assert.match(capture.config, /exclude = \["CODEX_DELEGATE_WORKER_API_KEY"\]/);
    assert.doesNotMatch(capture.config, /secret-from-json/);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("can pass provider config through codex -c overrides instead of temporary config.toml", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    fs.writeFileSync(
      path.join(tmpdir, ".codex-delegate-worker.json"),
      JSON.stringify({
        configMode: "inline",
        baseUrl: "https://inline-config.example.test/v1",
        model: "inline-config-model",
        providerId: "inline_provider",
        providerName: "Inline provider",
        codexBin: fakeCodex,
        apiKey: "inline-secret",
      }),
    );

    const result = await runNode([launcher, "do inline work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_API_KEY: "",
    }, { cwd: tmpdir });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.equal(capture.apiKey, "inline-secret");
    assert.deepEqual(capture.args, [
      "exec",
      "--ephemeral",
      "-c",
      'model="inline-config-model"',
      "-c",
      'model_provider="inline_provider"',
      "-c",
      'model_providers.inline_provider.name="Inline provider"',
      "-c",
      'model_providers.inline_provider.base_url="https://inline-config.example.test/v1"',
      "-c",
      'model_providers.inline_provider.env_key="CODEX_DELEGATE_WORKER_API_KEY"',
      "-c",
      'shell_environment_policy.exclude=["CODEX_DELEGATE_WORKER_API_KEY"]',
      "do inline work",
    ]);
    assert.equal(fs.existsSync(path.join(capture.codeHome, "config.toml")), false);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("uses inline config mode by default", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    const result = await runNode([launcher, "default inline work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
      CODEX_DELEGATE_WORKER_CODEX_BIN: fakeCodex,
      CODEX_DELEGATE_WORKER_BASE_URL: "https://default-inline.example.test/v1",
      CODEX_DELEGATE_WORKER_API_KEY: "default-inline-secret",
      CODEX_DELEGATE_WORKER_MODEL: "default-inline-model",
    });

    assert.equal(result.code, 0, result.stderr);
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.ok(capture.args.includes("-c"));
    assert.ok(capture.args.includes('model="default-inline-model"'));
    assert.equal(fs.existsSync(path.join(capture.codeHome, "config.toml")), false);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("rejects wireApi config because the launcher no longer exposes it", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-test-"));
  try {
    const { fakeCodex, capturePath } = makeFakeCodex(tmpdir);
    fs.writeFileSync(
      path.join(tmpdir, ".codex-delegate-worker.json"),
      JSON.stringify({
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "test-key",
        codexBin: fakeCodex,
        wireApi: "responses",
      }),
    );

    const result = await runNode([launcher, "do work"], {
      CODEX_DELEGATE_WORKER_CAPTURE_PATH: capturePath,
    }, { cwd: tmpdir });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /wireApi.*no longer supported/i);
    assert.match(result.stderr, /remove/i);
    assert.equal(fs.existsSync(capturePath), false);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});
