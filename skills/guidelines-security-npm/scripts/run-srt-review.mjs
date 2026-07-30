#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const MAX_OUTPUT_LIMIT = 10 * 1024 * 1024;
const MAX_SRT_ENTRY_BYTES = 10 * 1024 * 1024;
const MINIMUM_SRT_VERSION = "0.0.50";

class DiagnosticError extends Error {
  constructor(code, message, nextAction) {
    super(message);
    this.code = code;
    this.nextAction = nextAction;
  }
}

function usage() {
  return [
    "Usage:",
    "  node run-srt-review.mjs",
    "    --node /absolute/path/to/node",
    "    --srt-package-root /absolute/path/to/reviewed/sandbox-runtime",
    "    --expected-srt-version 0.0.0",
    "    --expected-srt-sha256 <64 lowercase hex characters>",
    "    --workdir /absolute/path/to/dedicated/quarantine",
    "    --evidence-dir /absolute/path/to/existing/evidence-directory",
    "    [--runtime-bin-dir /absolute/path/to/trusted/bin]",
    "    [--timeout-ms 60000] [--max-output-bytes 1048576]",
    "    -- /absolute/path/to/command [arg ...]",
  ].join("\n");
}

function writeBlocked(error, includeUsage = false) {
  const diagnostic =
    error instanceof DiagnosticError
      ? error
      : new DiagnosticError(
          "SRT_UNEXPECTED_LAUNCHER_ERROR",
          error.message,
          "Keep the gate blocked, inspect the launcher inputs and evidence directory, and do not retry the target outside the sandbox.",
        );
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "npm-srt-review-launcher",
        status: "blocked-pending-review",
        error: {
          code: diagnostic.code,
          message: diagnostic.message,
          nextAction: diagnostic.nextAction,
        },
        ...(includeUsage ? { usage: usage() } : {}),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
}

function parsePositiveInteger(value, name, maximum) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new DiagnosticError(
      "CLI_INVALID_POSITIVE_INTEGER",
      `${name} must be a positive integer`,
      `Set ${name} to a positive decimal integer within the documented limit.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new DiagnosticError(
      "CLI_LIMIT_TOO_LARGE",
      `${name} must not exceed ${maximum}`,
      `Lower ${name} to ${maximum} or less; do not weaken the limit merely to make suspicious code finish.`,
    );
  }
  return parsed;
}

function versionAtLeast(version, minimum) {
  const currentParts = version.split("-", 1)[0].split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] > minimumParts[index]) {
      return true;
    }
    if (currentParts[index] < minimumParts[index]) {
      return false;
    }
  }
  return !version.includes("-");
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    return { help: true };
  }
  const separator = argv.indexOf("--");
  if (separator === -1 || separator === argv.length - 1) {
    throw new DiagnosticError(
      "CLI_MISSING_COMMAND_SEPARATOR",
      "an explicit command is required after --",
      "Add -- followed by one absolute target command and its argv; do not use a shell command string.",
    );
  }

  const optionArgs = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_OUTPUT_LIMIT,
    runtimeBinDirs: [],
    command,
  };

  for (let index = 0; index < optionArgs.length; index += 2) {
    const flag = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!value) {
      throw new DiagnosticError(
        "CLI_MISSING_VALUE",
        `missing value for ${flag}`,
        `Provide a value immediately after ${flag}, then rerun with the same target argv.`,
      );
    }

    switch (flag) {
      case "--node":
        options.node = value;
        break;
      case "--srt-package-root":
        options.srtPackageRoot = value;
        break;
      case "--expected-srt-version":
        options.expectedSrtVersion = value;
        break;
      case "--expected-srt-sha256":
        options.expectedSrtSha256 = value;
        break;
      case "--workdir":
        options.workdir = value;
        break;
      case "--evidence-dir":
        options.evidenceDir = value;
        break;
      case "--runtime-bin-dir":
        options.runtimeBinDirs.push(value);
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(value, flag, MAX_TIMEOUT_MS);
        break;
      case "--max-output-bytes":
        options.maxOutputBytes = parsePositiveInteger(
          value,
          flag,
          MAX_OUTPUT_LIMIT,
        );
        break;
      default:
        throw new DiagnosticError(
          "CLI_UNKNOWN_ARGUMENT",
          `unknown argument: ${flag}`,
          "Remove the unknown flag and rerun using the usage returned with this error.",
        );
    }
  }

  for (const required of [
    "node",
    "srtPackageRoot",
    "expectedSrtVersion",
    "expectedSrtSha256",
    "workdir",
    "evidenceDir",
  ]) {
    if (!options[required]) {
      throw new DiagnosticError(
        "CLI_MISSING_REQUIRED_OPTION",
        `missing required option: ${required}`,
        "Provide every required reviewed runtime, quarantine, evidence, version, and digest option shown in usage.",
      );
    }
  }
  if (!/^[a-f0-9]{64}$/.test(options.expectedSrtSha256)) {
    throw new DiagnosticError(
      "CLI_INVALID_SRT_DIGEST",
      "--expected-srt-sha256 must be 64 lowercase hex characters",
      "Use the pre-reviewed SHA-256 of the exact SRT dist/cli.js; never copy a digest from the untrusted target.",
    );
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.expectedSrtVersion)) {
    throw new DiagnosticError(
      "CLI_INVALID_SRT_VERSION",
      "--expected-srt-version must be an exact version",
      "Provide the exact separately reviewed SRT package version, not a tag or range.",
    );
  }
  return options;
}

function regularRealPath(inputPath, label) {
  if (!path.isAbsolute(inputPath)) {
    throw new DiagnosticError(
      "PATH_NOT_ABSOLUTE",
      `${label} must be an absolute path`,
      `Resolve ${label} to an explicit absolute path without searching protected locations.`,
    );
  }
  let realPath;
  try {
    realPath = fs.realpathSync(inputPath);
  } catch {
    throw new DiagnosticError(
      "PATH_NOT_FOUND",
      `${label} is missing or inaccessible`,
      `Verify the explicit ${label} path and permissions, then rerun without auto-discovery.`,
    );
  }
  if (!fs.statSync(realPath).isFile()) {
    throw new DiagnosticError(
      "PATH_NOT_REGULAR_FILE",
      `${label} must resolve to a regular file`,
      `Provide a reviewed regular file for ${label}; do not pass a directory or special file.`,
    );
  }
  return realPath;
}

function directoryRealPath(inputPath, label, allowSymlink = true) {
  if (!path.isAbsolute(inputPath)) {
    throw new DiagnosticError(
      "PATH_NOT_ABSOLUTE",
      `${label} must be an absolute path`,
      `Resolve ${label} to an explicit absolute path without searching protected locations.`,
    );
  }
  let inputStat;
  let realPath;
  try {
    inputStat = fs.lstatSync(inputPath);
    realPath = fs.realpathSync(inputPath);
  } catch {
    throw new DiagnosticError(
      "PATH_NOT_FOUND",
      `${label} is missing or inaccessible`,
      `Create or verify the explicit ${label} directory, then rerun without auto-discovery.`,
    );
  }
  if (!allowSymlink && inputStat.isSymbolicLink()) {
    throw new DiagnosticError(
      "PATH_SYMBOLIC_LINK",
      `${label} must not be a symbolic link`,
      `Create a new real ${label} directory; do not follow or replace the link automatically.`,
    );
  }
  if (!fs.statSync(realPath).isDirectory()) {
    throw new DiagnosticError(
      "PATH_NOT_DIRECTORY",
      `${label} must resolve to a directory`,
      `Provide a reviewed directory for ${label}.`,
    );
  }
  return realPath;
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return isInside(left, right) || isInside(right, left);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pathEntryExists(inputPath) {
  try {
    fs.lstatSync(inputPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function readSrtIdentity(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJsonStat = fs.lstatSync(packageJsonPath);
  if (!packageJsonStat.isFile() || packageJsonStat.isSymbolicLink()) {
    throw new DiagnosticError(
      "SRT_INVALID_PACKAGE_JSON_FILE",
      "SRT package.json must be a regular, non-symlink file",
      "Use a separately reviewed SRT installation whose package.json is a regular file.",
    );
  }
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    throw new DiagnosticError(
      "SRT_INVALID_PACKAGE_JSON",
      "SRT package.json is not valid JSON",
      "Reject this SRT installation and obtain a clean, separately reviewed exact package.",
    );
  }
  if (packageJson.name !== "@anthropic-ai/sandbox-runtime") {
    throw new DiagnosticError(
      "SRT_PACKAGE_NAME_MISMATCH",
      "SRT package name does not match @anthropic-ai/sandbox-runtime",
      "Reject this package root and point to the separately reviewed Anthropic Sandbox Runtime package.",
    );
  }

  const cliPath = regularRealPath(
    path.join(packageRoot, "dist", "cli.js"),
    "SRT CLI",
  );
  if (!isInside(cliPath, packageRoot)) {
    throw new DiagnosticError(
      "SRT_CLI_ESCAPES_PACKAGE",
      "SRT CLI resolves outside the reviewed package root",
      "Reject the installation; use a clean package whose dist/cli.js is contained inside its reviewed root.",
    );
  }
  if (fs.statSync(cliPath).size > MAX_SRT_ENTRY_BYTES) {
    throw new DiagnosticError(
      "SRT_CLI_TOO_LARGE",
      `SRT CLI exceeds the ${MAX_SRT_ENTRY_BYTES}-byte limit`,
      "Treat the installation as abnormal and review its exact artifact before changing any limit.",
    );
  }
  return { cliPath, version: packageJson.version };
}

function denyReadRoots() {
  if (process.platform === "darwin") {
    return [
      "/Users",
      "/Volumes",
      "/private/tmp",
      "/private/var/folders",
      "/tmp",
      "/var/tmp",
    ];
  }
  if (process.platform === "linux") {
    return ["/home", "/root", "/media", "/mnt", "/tmp", "/var/tmp"];
  }
  throw new DiagnosticError(
    "SRT_UNSUPPORTED_PLATFORM",
    "the thin launcher currently supports only macOS and Linux",
    "Return Blocked Pending Review unless a separately reviewed platform-specific isolation path is added.",
  );
}

function killProcessTree(child) {
  try {
    if (child.pid && process.platform !== "win32") {
      process.kill(-child.pid, "SIGKILL");
      return;
    }
  } catch {
    // Fall through to killing the direct child.
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The process may already have exited.
  }
}

async function run() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
  } catch (error) {
    writeBlocked(error, true);
    return;
  }

  let nodePath;
  let packageRoot;
  let workdir;
  let evidenceDir;
  let srt;
  let commandPath;
  let runtimeBinDirs;
  try {
    nodePath = regularRealPath(options.node, "Node executable");
    packageRoot = directoryRealPath(options.srtPackageRoot, "SRT package root");
    workdir = directoryRealPath(options.workdir, "quarantine workdir", false);
    evidenceDir = directoryRealPath(
      options.evidenceDir,
      "evidence directory",
      false,
    );
    runtimeBinDirs = options.runtimeBinDirs.map((runtimeBinDir) =>
      directoryRealPath(runtimeBinDir, "runtime bin directory"),
    );

    if (
      path.dirname(workdir) !== path.dirname(evidenceDir) ||
      path.basename(workdir) !== "quarantine" ||
      path.basename(evidenceDir) !== "evidence"
    ) {
      throw new DiagnosticError(
        "REVIEW_DIRECTORY_LAYOUT_INVALID",
        "workdir and evidence directory must be sibling quarantine/ and evidence/ directories",
        "Create one review root containing real sibling directories named quarantine and evidence, stage only synthetic inputs in quarantine, then rerun.",
      );
    }
    if (
      pathsOverlap(packageRoot, workdir) ||
      pathsOverlap(packageRoot, evidenceDir) ||
      isInside(nodePath, workdir) ||
      isInside(nodePath, evidenceDir)
    ) {
      throw new DiagnosticError(
        "TRUSTED_RUNTIME_OVERLAP",
        "trusted runtime files must not overlap quarantine or evidence",
        "Move the reviewed Node and SRT runtime outside the review root; do not widen sandbox reads.",
      );
    }
    if (
      runtimeBinDirs.some(
        (runtimeBinDir) =>
          pathsOverlap(runtimeBinDir, workdir) ||
          pathsOverlap(runtimeBinDir, evidenceDir),
      )
    ) {
      throw new DiagnosticError(
        "RUNTIME_BIN_OVERLAP",
        "runtime bin directories must not overlap quarantine or evidence",
        "Point --runtime-bin-dir only to a separately reviewed external bin directory.",
      );
    }
    commandPath = regularRealPath(options.command[0], "target command");
    if (commandPath !== nodePath && !isInside(commandPath, workdir)) {
      throw new DiagnosticError(
        "TARGET_OUTSIDE_QUARANTINE",
        "target command must be the reviewed Node executable or inside quarantine",
        "Stage the exact target inside quarantine, or invoke the reviewed Node executable with a staged script; never run an arbitrary host command.",
      );
    }
    options.command[0] = commandPath;
    srt = readSrtIdentity(packageRoot);
    if (srt.version !== options.expectedSrtVersion) {
      throw new DiagnosticError(
        "SRT_VERSION_MISMATCH",
        `SRT version mismatch: expected ${options.expectedSrtVersion}, found ${srt.version}`,
        "Stop and review the installed exact SRT version; update the expected version only after that separate review.",
      );
    }
    if (!versionAtLeast(srt.version, MINIMUM_SRT_VERSION)) {
      throw new DiagnosticError(
        "SRT_VERSION_TOO_OLD",
        `SRT ${srt.version} predates required ${MINIMUM_SRT_VERSION}`,
        `Use and separately review SRT ${MINIMUM_SRT_VERSION} or newer; do not bypass this minimum.`,
      );
    }
    if (sha256File(srt.cliPath) !== options.expectedSrtSha256) {
      throw new DiagnosticError(
        "SRT_DIGEST_MISMATCH",
        "SRT CLI digest mismatch",
        "Reject this runtime. Recompute and update the expected digest only after reviewing the exact installed dist/cli.js.",
      );
    }
  } catch (error) {
    writeBlocked(error);
    return;
  }

  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const homeDir = path.join(workdir, ".srt-home");
  const tempDir = path.join(workdir, ".srt-tmp");
  if (pathEntryExists(homeDir) || pathEntryExists(tempDir)) {
    writeBlocked(
      new DiagnosticError(
        "RESERVED_SANDBOX_PATH_EXISTS",
        "reserved sandbox home or temp path already exists",
        "Create a new clean review root with fresh quarantine and evidence siblings. Do not delete or reuse the existing paths automatically.",
      ),
    );
    return;
  }
  fs.mkdirSync(homeDir, { mode: 0o700 });
  fs.mkdirSync(tempDir, { mode: 0o700 });

  const settings = {
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: [...denyReadRoots(), evidenceDir],
      allowRead: [workdir, nodePath, packageRoot, ...runtimeBinDirs],
      allowWrite: [workdir],
      denyWrite: [evidenceDir, packageRoot, nodePath, ...runtimeBinDirs],
    },
    ignoreViolations: {},
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  };

  const settingsPath = path.join(evidenceDir, `srt-policy-${runId}.json`);
  const stdoutPath = path.join(evidenceDir, `srt-stdout-${runId}.bin`);
  const stderrPath = path.join(evidenceDir, `srt-stderr-${runId}.bin`);
  const resultPath = path.join(evidenceDir, `srt-result-${runId}.json`);
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  const childEnvironment = {
    HOME: homeDir,
    TMPDIR: tempDir,
    PATH: [path.dirname(nodePath), ...runtimeBinDirs, "/usr/bin", "/bin"].join(
      ":",
    ),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
  };

  const child = spawn(
    nodePath,
    [srt.cliPath, "--settings", settingsPath, "--", ...options.command],
    {
      cwd: workdir,
      env: childEnvironment,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let storedStdoutBytes = 0;
  let storedStderrBytes = 0;
  const stdoutChunks = [];
  const stderrChunks = [];
  let terminationReason = null;
  let spawnError = null;

  const capture = (chunks, chunk, stream) => {
    const currentTotal = stream === "stdout" ? stdoutBytes : stderrBytes;
    const currentStored =
      stream === "stdout" ? storedStdoutBytes : storedStderrBytes;
    const nextTotal = currentTotal + chunk.length;
    if (stream === "stdout") {
      stdoutBytes = nextTotal;
    } else {
      stderrBytes = nextTotal;
    }

    const remaining = Math.max(options.maxOutputBytes - currentStored, 0);
    if (remaining > 0) {
      const storedChunk =
        chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      chunks.push(storedChunk);
      if (stream === "stdout") {
        storedStdoutBytes += storedChunk.length;
      } else {
        storedStderrBytes += storedChunk.length;
      }
    }
    if (nextTotal > options.maxOutputBytes) {
      terminationReason = "output-limit";
      killProcessTree(child);
    }
  };

  child.stdout.on("data", (chunk) => capture(stdoutChunks, chunk, "stdout"));
  child.stderr.on("data", (chunk) => capture(stderrChunks, chunk, "stderr"));
  child.on("error", (error) => {
    spawnError = error.message;
  });

  const timeout = setTimeout(() => {
    terminationReason = terminationReason ?? "timeout";
    killProcessTree(child);
  }, options.timeoutMs);

  const { code, signal } = await new Promise((resolve) => {
    child.on("close", (exitCode, exitSignal) => {
      resolve({ code: exitCode, signal: exitSignal });
    });
  });
  clearTimeout(timeout);

  fs.writeFileSync(stdoutPath, Buffer.concat(stdoutChunks), {
    flag: "wx",
    mode: 0o600,
  });
  fs.writeFileSync(stderrPath, Buffer.concat(stderrChunks), {
    flag: "wx",
    mode: 0o600,
  });

  const status =
    spawnError || (!terminationReason && code !== 0)
      ? "blocked-pending-review"
      : terminationReason ?? "completed";
  const outcome = {
    completed: {
      code: "SRT_RUN_COMPLETED",
      nextAction:
        "Inspect the bounded evidence and continue every remaining review gate. Do not describe the target as safe.",
    },
    "blocked-pending-review": {
      code: spawnError ? "SRT_LAUNCH_ERROR" : "SRT_OR_TARGET_EXIT_NONZERO",
      nextAction:
        spawnError
          ? "Fix and revalidate the reviewed sandbox runtime; never fall back to direct host execution."
          : "The launcher cannot prove whether SRT failed before target execution. Inspect captured evidence, keep the package blocked, and do not retry on the host.",
    },
    timeout: {
      code: "TARGET_TIMEOUT",
      nextAction:
        "Treat the timeout as suspicious or resource-intensive behavior. Keep the package blocked unless a stronger resource boundary justifies another run.",
    },
    "output-limit": {
      code: "TARGET_OUTPUT_LIMIT",
      nextAction:
        "Inspect the bounded evidence and treat output flooding as a risk signal. Do not raise the limit merely to make the target finish.",
    },
  }[status];
  const result = {
    tool: "npm-srt-review-launcher",
    status,
    code: outcome.code,
    nextAction: outcome.nextAction,
    exitCode: code,
    signal,
    durationLimitMs: options.timeoutMs,
    outputLimitBytesPerStream: options.maxOutputBytes,
    capturedBytes: {
      stdout: storedStdoutBytes,
      stderr: storedStderrBytes,
    },
    evidence: {
      policy: settingsPath,
      stdout: stdoutPath,
      stderr: stderrPath,
    },
    srt: {
      package: "@anthropic-ai/sandbox-runtime",
      version: srt.version,
      cliSha256: options.expectedSrtSha256,
    },
    limitations: [
      "SRT is a beta filesystem and network isolation layer, not proof that the target is safe.",
      "This launcher enforces wall-clock and captured-output limits but not CPU, memory, process-count, file-count, or disk quotas.",
      "Only synthetic, disposable inputs belong in the quarantine workdir.",
    ],
  };
  if (spawnError) {
    result.error = spawnError;
  }
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status,
        code: outcome.code,
        nextAction: outcome.nextAction,
        result: resultPath,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode =
    status === "completed" ? 0 : ["timeout", "output-limit"].includes(status) ? 1 : 2;
}

run().catch((error) => {
  writeBlocked(error);
});
