#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { finished } from "node:stream/promises";
import { configPaths, configurationStatus, loadWorkerConfig, makeProfileStore } from "./provider-config.mjs";
import { configureInTerminal, openConfiguration } from "./configure.mjs";
import { privateOutputStream, redactOutput } from "./private-output.mjs";

const ENV_PREFIX = "CODEX_DELEGATE_WORKER_";
const API_KEY_ENV = `${ENV_PREFIX}API_KEY`;

function usage() {
  return `Usage:
  node scripts/codex-delegate-worker.mjs init [--local | --global]
  node scripts/codex-delegate-worker.mjs status
  node scripts/codex-delegate-worker.mjs open [native Codex arguments]
  node scripts/codex-delegate-worker.mjs interactive [native Codex arguments]
  node scripts/codex-delegate-worker.mjs "task"
  node scripts/codex-delegate-worker.mjs -- <native Codex arguments>

init opens private provider management; configure runs it in your own terminal.
open (or no arguments) opens normal interactive Codex in a separate terminal.
interactive runs normal Codex directly in your own terminal.
A task uses codex exec. Arguments after -- go directly to Codex.
Native configuration, permissions, plugins, and session storage are inherited.
`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
}

function tomlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t")}"`;
}

function configOverride(key, value) {
  return ["-c", `${key}=${value}`];
}

function parseArgsJson(value) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch { /* Report the expected shape without echoing the input. */ }
  fail(`${ENV_PREFIX}AUTH_ARGS_JSON must be a JSON array of strings`);
}

function buildProviderArgs(options) {
  const provider = `model_providers.${options.providerId}`;
  const args = [
    ...configOverride("model", tomlString(options.model)),
    ...configOverride("model_provider", tomlString(options.providerId)),
    ...configOverride(`${provider}.name`, tomlString(options.providerName)),
    ...configOverride(`${provider}.base_url`, tomlString(options.baseUrl)),
  ];
  if (options.authCommand) {
    args.push(
      ...configOverride(`${provider}.auth.command`, tomlString(options.authCommand)),
      ...configOverride(`${provider}.auth.args`, `[${options.authArgs.map(tomlString).join(", ")}]`),
      ...configOverride(`${provider}.auth.refresh_interval_ms`, "0"),
    );
  } else if (options.apiKey) {
    args.push(...configOverride(`${provider}.env_key`, tomlString(API_KEY_ENV)));
  }
  return args;
}

function shouldUseShell(command) {
  return process.platform === "win32" && (/\.(cmd|bat)$/i.test(command) || !/[\\/]/.test(command));
}

async function runCodex(nativeArgs, { paths = configPaths(), interactive = false, codexHome } = {}) {
  const fileConfig = loadWorkerConfig({ paths });
  const fileAuth = fileConfig.auth && typeof fileConfig.auth === "object" ? fileConfig.auth : {};
  const authArgs = process.env[`${ENV_PREFIX}AUTH_ARGS_JSON`]
    ? parseArgsJson(process.env[`${ENV_PREFIX}AUTH_ARGS_JSON`])
    : fileAuth.args ?? fileConfig.authArgs ?? [];
  if (!Array.isArray(authArgs) || authArgs.some((item) => typeof item !== "string")) fail("config auth args must be an array of strings");
  const options = {
    baseUrl: firstValue(process.env[`${ENV_PREFIX}BASE_URL`], fileConfig.baseUrl),
    model: firstValue(process.env[`${ENV_PREFIX}MODEL`], fileConfig.model),
    apiKey: firstValue(process.env[API_KEY_ENV], fileConfig.apiKey),
    authCommand: firstValue(process.env[`${ENV_PREFIX}AUTH_COMMAND`], fileAuth.command, fileConfig.authCommand),
    authArgs,
    providerId: firstValue(process.env[`${ENV_PREFIX}PROVIDER_ID`], fileConfig.providerId, "codex_delegate_worker"),
    providerName: firstValue(process.env[`${ENV_PREFIX}PROVIDER_NAME`], fileConfig.providerName, "Codex delegate worker"),
  };
  // Codex's -c paths split on dots rather than parsing quoted TOML keys.
  // Preserve ordinary ids and encode other labels instead of rejecting them.
  if (!/^[A-Za-z0-9_-]+$/.test(options.providerId)) {
    options.providerId = `custom_${Buffer.from(String(options.providerId)).toString("base64url")}`;
  }
  if (!options.baseUrl || !options.model) fail("Worker is not configured. Run init to add a provider in the private configuration terminal.");
  const codexBin = firstValue(process.env[`${ENV_PREFIX}CODEX_BIN`], fileConfig.codexBin, "codex");
  const childEnv = { ...process.env };
  // A desktop terminal may start with a different shell environment. Restore the
  // caller's actual Codex home there; never substitute a temporary home.
  if (codexHome) childEnv.CODEX_HOME = codexHome;
  if (options.apiKey) childEnv[API_KEY_ENV] = options.apiKey;
  else delete childEnv[API_KEY_ENV];
  const child = spawn(codexBin, [...buildProviderArgs(options), ...nativeArgs], {
    env: childEnv,
    shell: shouldUseShell(codexBin),
    stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  const redact = redactOutput(options);
  const outputs = interactive ? [] : [child.stdout.pipe(privateOutputStream(options)), child.stderr.pipe(privateOutputStream(options))];
  if (outputs.length) {
    outputs[0].pipe(process.stdout, { end: false });
    outputs[1].pipe(process.stderr, { end: false });
  }
  const outputDone = Promise.all(outputs.map((stream) => finished(stream)));
  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      for (const stream of outputs) stream.end();
      process.stderr.write(`failed to launch codex: ${redact(error.message)}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      outputDone.then(() => {
        if (signal) process.stderr.write(`codex exited from signal ${signal}\n`);
        resolve(code ?? 1);
      }, reject);
    });
  });
}

function terminalContext(args) {
  const boundary = args.indexOf("--");
  const controls = boundary === -1 ? args : args.slice(0, boundary);
  const value = (flag) => controls.includes(flag) ? controls[controls.indexOf(flag) + 1] : undefined;
  const cwd = value("--directory") || process.cwd();
  const paths = configPaths({ cwd });
  if (value("--global-config")) paths.global = value("--global-config");
  return { cwd, paths, nativeArgs: boundary === -1 ? [] : args.slice(boundary + 1) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") return runCodex(args.slice(1));
  if (["--help", "-h"].includes(args[0]) || (["init", "configure"].includes(args[0]) && args.includes("--help"))) {
    process.stdout.write(usage());
    return 0;
  }
  if (args[0] === "init") {
    const scope = args.includes("--local") ? "local" : args.includes("--global") ? "global" : undefined;
    await openConfiguration({ scope });
    process.stdout.write("Private configuration terminal opened. Enter provider details there, not in the AI conversation.\n");
    return 0;
  }
  if (args[0] === "configure") {
    const { paths } = terminalContext(args);
    const scope = args.includes("--local") ? "local" : args.includes("--global") ? "global" : undefined;
    await configureInTerminal({ scope, store: makeProfileStore({ paths }) });
    return 0;
  }
  if (args[0] === "status") {
    process.stdout.write(`${JSON.stringify(configurationStatus())}\n`);
    return 0;
  }
  if (args[0] === "open" || !args.length) {
    await openConfiguration({ action: "native", nativeArgs: args.slice(1) });
    process.stdout.write("Native Codex terminal opened with the configured model node.\n");
    return 0;
  }
  if (args[0] === "interactive") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail("Interactive Codex needs your own terminal. Use open to launch one.");
    return runCodex(args.slice(1), { interactive: true });
  }
  if (args[0] === "_native-terminal") {
    const { cwd, paths, nativeArgs } = terminalContext(args);
    process.chdir(cwd);
    return runCodex(nativeArgs, { paths, interactive: true, codexHome: path.dirname(paths.global) });
  }
  const execArgs = ["exec", ...(args.includes("--skip-git-repo-check") ? [] : ["--skip-git-repo-check"]), ...args];
  return runCodex(execArgs);
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
