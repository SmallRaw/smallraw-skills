#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_PREFIX = "CODEX_DELEGATE_WORKER_";
const API_KEY_ENV = `${ENV_PREFIX}API_KEY`;

function usage() {
  return `Usage:
  ${ENV_PREFIX}BASE_URL=https://provider.example/v1 ${API_KEY_ENV}=... node scripts/codex-delegate-worker.mjs "task"

Environment:
  ${ENV_PREFIX}BASE_URL        Required provider base URL.
  ${ENV_PREFIX}CONFIG_FILE     Optional JSON config file path.
  ${API_KEY_ENV}         Provider API key for low-friction env-key mode.
  ${ENV_PREFIX}AUTH_COMMAND    Secret helper command for high-security auth mode.
  ${ENV_PREFIX}AUTH_ARGS_JSON  Optional JSON array of args for AUTH_COMMAND.
  ${ENV_PREFIX}MODEL           Default: deepseek-flash.
  ${ENV_PREFIX}PROVIDER_ID     Default: codex_delegate_worker.
  ${ENV_PREFIX}PROVIDER_NAME   Default: Codex delegate worker.
  ${ENV_PREFIX}CONFIG_MODE     inline (default) or temp-home.
  ${ENV_PREFIX}CODEX_BIN       Optional codex executable path or command.
  ${ENV_PREFIX}KEEP_HOME       Set to 1 to keep the temporary CODEX_HOME for debugging.
`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return "";
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function tomlString(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;
}

function tomlArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function configOverride(key, value) {
  return ["-c", `${key}=${value}`];
}

function isValidProviderId(value) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function parseArgsJson(value) {
  if (!value) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    fail(`${ENV_PREFIX}AUTH_ARGS_JSON must be a JSON array of strings`);
  }

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    fail(`${ENV_PREFIX}AUTH_ARGS_JSON must be a JSON array of strings`);
  }
  return parsed;
}

function readJsonConfig(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`config file must contain a JSON object: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`invalid JSON config file: ${filePath}`);
    }
    throw error;
  }
}

function globalConfigPath() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "codex-delegate-worker.json");
}

function loadConfig() {
  return {
    ...readJsonConfig(globalConfigPath()),
    ...readJsonConfig(path.join(process.cwd(), ".codex-delegate-worker.json")),
    ...readJsonConfig(process.env[`${ENV_PREFIX}CONFIG_FILE`] || ""),
  };
}

function shouldUseShell(command) {
  if (process.platform !== "win32") {
    return false;
  }
  return /\.(cmd|bat)$/i.test(command) || !/[\\/]/.test(command);
}

function writeConfig(configPath, options) {
  const lines = [
    `model = ${tomlString(options.model)}`,
    `model_provider = ${tomlString(options.providerId)}`,
    "",
    `[model_providers.${options.providerId}]`,
    `name = ${tomlString(options.providerName)}`,
    `base_url = ${tomlString(options.baseUrl)}`,
  ];

  if (options.authCommand) {
    lines.push(
      "",
      `[model_providers.${options.providerId}.auth]`,
      `command = ${tomlString(options.authCommand)}`,
      `args = ${tomlArray(options.authArgs)}`,
      "refresh_interval_ms = 0",
    );
  } else {
    lines.push(`env_key = ${tomlString(API_KEY_ENV)}`);
  }

  if (!options.authCommand) {
    lines.push(
      "",
      "[shell_environment_policy]",
      `exclude = ${tomlArray([API_KEY_ENV])}`,
    );
  }

  fs.writeFileSync(configPath, `${lines.join("\n")}\n`, "utf8");
}

function buildInlineConfigArgs(options) {
  const args = [
    ...configOverride("model", tomlString(options.model)),
    ...configOverride("model_provider", tomlString(options.providerId)),
    ...configOverride(`model_providers.${options.providerId}.name`, tomlString(options.providerName)),
    ...configOverride(`model_providers.${options.providerId}.base_url`, tomlString(options.baseUrl)),
  ];

  if (options.authCommand) {
    args.push(
      ...configOverride(`model_providers.${options.providerId}.auth.command`, tomlString(options.authCommand)),
      ...configOverride(`model_providers.${options.providerId}.auth.args`, tomlArray(options.authArgs)),
      ...configOverride(`model_providers.${options.providerId}.auth.refresh_interval_ms`, "0"),
    );
  } else {
    args.push(
      ...configOverride(`model_providers.${options.providerId}.env_key`, tomlString(API_KEY_ENV)),
      ...configOverride("shell_environment_policy.exclude", tomlArray([API_KEY_ENV])),
    );
  }

  return args;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }

  if (args.length === 0) {
    process.stderr.write(usage());
    return 2;
  }

  const fileConfig = loadConfig();
  const fileAuth = fileConfig.auth && typeof fileConfig.auth === "object"
    ? fileConfig.auth
    : {};

  const baseUrl = firstValue(process.env[`${ENV_PREFIX}BASE_URL`], fileConfig.baseUrl);
  const apiKey = firstValue(process.env[API_KEY_ENV], fileConfig.apiKey);
  const authCommand = firstValue(
    process.env[`${ENV_PREFIX}AUTH_COMMAND`],
    fileAuth.command,
    fileConfig.authCommand,
  );
  const authArgs = process.env[`${ENV_PREFIX}AUTH_ARGS_JSON`]
    ? parseArgsJson(process.env[`${ENV_PREFIX}AUTH_ARGS_JSON`])
    : Array.isArray(fileAuth.args)
      ? fileAuth.args
      : Array.isArray(fileConfig.authArgs)
        ? fileConfig.authArgs
        : [];
  if (authArgs.some((item) => typeof item !== "string")) {
    fail("config auth args must be an array of strings");
  }

  const model = firstValue(process.env[`${ENV_PREFIX}MODEL`], fileConfig.model, "deepseek-flash");
  const providerId =
    firstValue(process.env[`${ENV_PREFIX}PROVIDER_ID`], fileConfig.providerId, "codex_delegate_worker");
  const providerName =
    firstValue(process.env[`${ENV_PREFIX}PROVIDER_NAME`], fileConfig.providerName, "Codex delegate worker");
  const configMode = firstValue(process.env[`${ENV_PREFIX}CONFIG_MODE`], fileConfig.configMode, "inline");
  const codexBin = firstValue(process.env[`${ENV_PREFIX}CODEX_BIN`], fileConfig.codexBin, "codex");
  const keepHome = firstValue(process.env[`${ENV_PREFIX}KEEP_HOME`], fileConfig.keepHome) === "1";

  if (!baseUrl) {
    fail(`missing ${ENV_PREFIX}BASE_URL`);
  }
  if (!apiKey && !authCommand) {
    fail(`missing ${API_KEY_ENV}`);
  }
  if (!isValidProviderId(providerId)) {
    fail(`${ENV_PREFIX}PROVIDER_ID must contain only letters, numbers, underscores, or hyphens`);
  }
  if (
    hasValue(process.env[`${ENV_PREFIX}WIRE_API`]) ||
    hasValue(fileConfig.wireApi) ||
    hasValue(fileConfig.wire_api)
  ) {
    fail(`wireApi / ${ENV_PREFIX}WIRE_API is no longer supported; remove it and point baseUrl at a Responses-compatible endpoint`);
  }
  if (!["temp-home", "inline"].includes(configMode)) {
    fail(`${ENV_PREFIX}CONFIG_MODE must be "temp-home" or "inline"`);
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-delegate-worker-"));
  const providerOptions = {
    baseUrl,
    model,
    providerId,
    providerName,
    authCommand,
    authArgs,
  };
  if (configMode === "temp-home") {
    writeConfig(path.join(tempHome, "config.toml"), providerOptions);
  }

  const codexArgs = [
    "exec",
    "--ephemeral",
    ...(configMode === "inline" ? buildInlineConfigArgs(providerOptions) : []),
    ...args,
  ];

  const childEnv = {
    ...process.env,
    CODEX_HOME: tempHome,
  };
  if (apiKey) {
    childEnv[API_KEY_ENV] = apiKey;
  } else {
    delete childEnv[API_KEY_ENV];
  }

  const child = spawn(codexBin, codexArgs, {
    env: childEnv,
    shell: shouldUseShell(codexBin),
    stdio: "inherit",
    windowsHide: true,
  });

  return await new Promise((resolve) => {
    child.on("error", (error) => {
      process.stderr.write(`failed to launch codex: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      if (!keepHome) {
        fs.rmSync(tempHome, { recursive: true, force: true });
      } else {
        process.stderr.write(`kept temporary CODEX_HOME: ${tempHome}\n`);
      }

      if (signal) {
        process.stderr.write(`codex exited from signal ${signal}\n`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
