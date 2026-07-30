#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const MAX_JSON_BYTES = 50 * 1024 * 1024;
const DEFAULT_REGISTRY_HOST = "registry.npmjs.org";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const EXACT_SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA512_INTEGRITY = /^sha512-([A-Za-z0-9+/]+={0,2})$/;
const FINDING_ACTIONS = {
  INVALID_DEPENDENCY_SECTION:
    "Fix this dependency section so it is a JSON object mapping package names to versions, then regenerate the lockfile without scripts.",
  MANIFEST_LOCK_MISMATCH:
    "Regenerate package-lock.json from the reviewed package.json with lifecycle scripts disabled; do not hand-edit the mismatch away.",
  NON_EXACT_DIRECT_SPEC:
    "Replace the range, tag, alias, URL, Git, file, or workspace spec with an explicitly reviewed exact version.",
  LOCAL_OR_WORKSPACE_LINK:
    "Verify the linked source separately and obtain explicit approval for this non-registry dependency; otherwise reject it.",
  MISSING_VERSION:
    "Regenerate the lockfile from an exact dependency version and require a resolved immutable version before continuing.",
  MISSING_SOURCE:
    "Regenerate the lockfile against the approved registry and require an explicit resolved source before continuing.",
  UNSUPPORTED_SOURCE:
    "Replace this source with an approved HTTPS registry artifact or obtain explicit review for the non-registry source.",
  INSECURE_SOURCE:
    "Reject the HTTP source and resolve the exact package from an approved HTTPS registry.",
  UNAPPROVED_REGISTRY:
    "Confirm the registry with the user; only then rerun with --allow-host <exact-host>. Do not add wildcard hosts.",
  SOURCE_URL_CREDENTIALS:
    "Remove embedded credentials and use an approved credential broker outside the lockfile.",
  UNAPPROVED_REGISTRY_PORT:
    "Use the approved registry on standard HTTPS or obtain explicit approval for this exact host and port.",
  TARBALL_PACKAGE_MISMATCH:
    "Reject the lockfile entry and regenerate it from the approved registry; verify the exact package name, version, and integrity.",
  MISSING_OR_WEAK_INTEGRITY:
    "Regenerate the lockfile from the approved registry and require a valid sha512 integrity value.",
  INSTALL_SCRIPT:
    "Inspect the exact lifecycle script and every invoked file at L3 before considering isolated execution.",
  PACKAGE_BINARY:
    "Inspect the exact bin entry point and invoked files before running the package binary.",
  PLATFORM_OR_OPTIONAL_PACKAGE:
    "Review every platform-specific resolution and artifact for the intended OS and CPU.",
  LOCKFILE_FORMAT_DOWNGRADE:
    "Restore the expected lockfile format with the trusted package-manager version; investigate why it changed.",
  DEPENDENCY_COUNT_EXPLOSION:
    "Review the complete added graph and confirm the increase is required before continuing.",
};

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
    "  node preflight-lockfile.mjs --manifest /path/package.json",
    "    --lockfile /path/package-lock.json",
    "    [--baseline /path/to/previous/package-lock.json]",
    "    [--allow-host registry.example.com]",
  ].join("\n");
}

function writeBlocked(error, includeUsage = false) {
  const diagnostic =
    error instanceof DiagnosticError
      ? error
      : new DiagnosticError(
          "PREFLIGHT_UNEXPECTED_ERROR",
          error.message,
          "Keep the gate blocked, inspect the explicit input paths and script version, and do not run dependency code on the host.",
        );
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "npm-lockfile-preflight",
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

function parseArgs(argv) {
  const options = {
    allowedHosts: new Set([DEFAULT_REGISTRY_HOST]),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--help") {
      options.help = true;
      continue;
    }

    if (!["--manifest", "--lockfile", "--baseline", "--allow-host"].includes(flag)) {
      throw new DiagnosticError(
        "CLI_UNKNOWN_ARGUMENT",
        `unknown argument: ${flag}`,
        "Remove the unknown flag and rerun using the usage returned with this error.",
      );
    }
    if (!value || value.startsWith("--")) {
      throw new DiagnosticError(
        "CLI_MISSING_VALUE",
        `missing value for ${flag}`,
        `Provide a value immediately after ${flag}, then rerun the same preflight.`,
      );
    }
    index += 1;

    if (flag === "--allow-host") {
      const host = value.toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) {
        throw new DiagnosticError(
          "CLI_INVALID_REGISTRY_HOST",
          `invalid registry host: ${value}`,
          "Use one exact lowercase hostname without a scheme, port, path, or wildcard.",
        );
      }
      options.allowedHosts.add(host);
    } else {
      options[flag.slice(2)] = value;
    }
  }

  if (!options.help && (!options.manifest || !options.lockfile)) {
    throw new DiagnosticError(
      "CLI_MISSING_REQUIRED_ARGUMENT",
      "--manifest and --lockfile are required",
      "Pass explicit paths to regular files named package.json and package-lock.json.",
    );
  }
  return options;
}

function readJson(inputPath, requiredName) {
  const absolutePath = path.resolve(inputPath);
  if (path.basename(absolutePath) !== requiredName) {
    throw new DiagnosticError(
      "INPUT_UNEXPECTED_FILENAME",
      `expected a file named ${requiredName}`,
      `Stage the intended review input under the exact filename ${requiredName}; do not point this tool at another file type.`,
    );
  }

  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    throw new DiagnosticError(
      "INPUT_NOT_FOUND",
      `${requiredName} is missing or inaccessible`,
      `Verify the explicit ${requiredName} path and permissions without searching protected locations, then rerun.`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DiagnosticError(
      "INPUT_UNSAFE_FILE_TYPE",
      `${requiredName} must be a regular, non-symlink file`,
      `Copy the reviewed ${requiredName} into the isolated review directory as a regular file; do not follow the link.`,
    );
  }
  if (stat.size > MAX_JSON_BYTES) {
    throw new DiagnosticError(
      "INPUT_TOO_LARGE",
      `${requiredName} exceeds the ${MAX_JSON_BYTES}-byte limit`,
      "Treat the input as abnormal and inspect its origin and size before increasing any limit.",
    );
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch {
    throw new DiagnosticError(
      "INPUT_INVALID_JSON",
      `${requiredName} is not valid JSON`,
      `Regenerate or repair ${requiredName} with the trusted package manager or editor, then rerun before any dependency execution.`,
    );
  }
}

function validateLockfile(lockfile, label) {
  if (![2, 3].includes(lockfile.lockfileVersion)) {
    throw new DiagnosticError(
      "LOCKFILE_UNSUPPORTED_VERSION",
      `${label} uses unsupported package-lock format; require version 2 or 3`,
      "Regenerate package-lock.json with a trusted npm version that writes lockfileVersion 2 or 3, with lifecycle scripts disabled.",
    );
  }
  if (
    !lockfile.packages ||
    typeof lockfile.packages !== "object" ||
    Array.isArray(lockfile.packages)
  ) {
    throw new DiagnosticError(
      "LOCKFILE_MISSING_PACKAGES",
      `${label} does not contain a packages map`,
      "Regenerate a complete npm package-lock.json; do not continue with partial coverage.",
    );
  }
  if (
    typeof lockfile.packages[""] !== "object" ||
    lockfile.packages[""] === null ||
    Array.isArray(lockfile.packages[""])
  ) {
    throw new DiagnosticError(
      "LOCKFILE_INVALID_ROOT",
      `${label} does not contain a valid root package entry`,
      "Regenerate the lockfile from the reviewed package.json with scripts disabled.",
    );
  }
  for (const entry of Object.values(lockfile.packages)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new DiagnosticError(
        "LOCKFILE_MALFORMED_ENTRY",
        `${label} contains a malformed package entry`,
        "Reject manual lockfile edits and regenerate the complete lockfile with the trusted package manager.",
      );
    }
  }
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = lockfile.packages[""][section];
    if (
      dependencies !== undefined &&
      (typeof dependencies !== "object" ||
        dependencies === null ||
        Array.isArray(dependencies))
    ) {
      throw new DiagnosticError(
        "LOCKFILE_MALFORMED_ROOT_SECTION",
        `${label} contains a malformed root ${section} section`,
        "Regenerate the lockfile from the reviewed manifest; the root dependency section must be an object.",
      );
    }
  }
}

function validateManifest(manifest) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    throw new DiagnosticError(
      "MANIFEST_INVALID_ROOT",
      "package.json root is not an object",
      "Repair package.json so its root is a JSON object before resolving dependencies.",
    );
  }
}

function packageName(entryPath, entry) {
  if (typeof entry.name === "string" && entry.name) {
    return entry.name;
  }

  const marker = "node_modules/";
  const markerIndex = entryPath.lastIndexOf(marker);
  if (markerIndex === -1) {
    return entryPath;
  }
  const segments = entryPath.slice(markerIndex + marker.length).split("/");
  return segments[0]?.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function fingerprint(entry) {
  return JSON.stringify({
    version: entry?.version,
    resolved: entry?.resolved,
    integrity: entry?.integrity,
    link: entry?.link,
    hasInstallScript: entry?.hasInstallScript,
    bin: entry?.bin,
    os: entry?.os,
    cpu: entry?.cpu,
    dependencies: entry?.dependencies,
    optionalDependencies: entry?.optionalDependencies,
    peerDependencies: entry?.peerDependencies,
    peerDependenciesMeta: entry?.peerDependenciesMeta,
    dev: entry?.dev,
    optional: entry?.optional,
    bundled: entry?.bundled,
  });
}

function dependencySpec(lockfile, section, name) {
  return lockfile?.packages?.[""]?.[section]?.[name];
}

function changedPackageKeys(current, baseline) {
  const currentKeys = Object.keys(current.packages).filter((key) => key);
  if (!baseline) {
    return new Set(currentKeys);
  }

  return new Set(
    currentKeys.filter(
      (key) =>
        !Object.hasOwn(baseline.packages, key) ||
        fingerprint(current.packages[key]) !== fingerprint(baseline.packages[key]),
    ),
  );
}

function removedPackageKeys(current, baseline) {
  if (!baseline) {
    return [];
  }
  return Object.keys(baseline.packages).filter(
    (key) => key && !Object.hasOwn(current.packages, key),
  );
}

function hasSha512Integrity(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = SHA512_INTEGRITY.exec(value);
  return Boolean(match && Buffer.from(match[1], "base64").length === 64);
}

function officialTarballMatches(resolved, name, version) {
  if (
    resolved.hostname.toLowerCase() !== DEFAULT_REGISTRY_HOST ||
    typeof name !== "string" ||
    typeof version !== "string"
  ) {
    return true;
  }
  try {
    const decodedPath = decodeURIComponent(resolved.pathname);
    const [packagePath, fileName, extra] = decodedPath.split("/-/");
    const expectedPackagePath = `/${name}`;
    const packageLeaf = name.split("/").at(-1);
    return (
      extra === undefined &&
      packagePath === expectedPackagePath &&
      fileName === `${packageLeaf}-${version}.tgz`
    );
  } catch {
    return false;
  }
}

function main() {
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

  let manifest;
  let lockfile;
  let baseline;
  try {
    manifest = readJson(options.manifest, "package.json");
    validateManifest(manifest);
    lockfile = readJson(options.lockfile, "package-lock.json");
    validateLockfile(lockfile, "current lockfile");
    if (options.baseline) {
      baseline = readJson(options.baseline, "package-lock.json");
      validateLockfile(baseline, "baseline lockfile");
    }
  } catch (error) {
    writeBlocked(error);
    return;
  }

  const findings = [];
  const addFinding = (severity, code, subject, detail) => {
    const action = FINDING_ACTIONS[code];
    if (!action) {
      throw new DiagnosticError(
        "PREFLIGHT_MISSING_REMEDIATION",
        `missing remediation for finding code ${code}`,
        "Keep the gate blocked and add a reviewed remediation mapping for this stable finding code before rerunning.",
      );
    }
    findings.push({ severity, code, subject, detail, action });
  };

  const changedKeys = changedPackageKeys(lockfile, baseline);
  const removedKeys = removedPackageKeys(lockfile, baseline);
  let changedDirectSpecs = 0;

  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section] ?? {};
    const previousDependencies = baseline?.packages?.[""]?.[section] ?? {};
    const lockedDependencies = lockfile.packages[""][section] ?? {};
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    ) {
      addFinding("high", "INVALID_DEPENDENCY_SECTION", section, "section is not an object");
      continue;
    }

    const dependencyNames = new Set([
      ...Object.keys(dependencies),
      ...Object.keys(previousDependencies),
      ...Object.keys(lockedDependencies),
    ]);
    for (const name of dependencyNames) {
      const spec = dependencies[name];
      const previousSpec = dependencySpec(baseline, section, name);
      if (dependencySpec(lockfile, section, name) !== spec) {
        addFinding(
          "high",
          "MANIFEST_LOCK_MISMATCH",
          name,
          `${section} differs between package.json and package-lock.json`,
        );
      }
      if (baseline && spec === previousSpec) {
        continue;
      }
      changedDirectSpecs += 1;
      if (spec !== undefined && (typeof spec !== "string" || !EXACT_SEMVER.test(spec))) {
        addFinding(
          "high",
          "NON_EXACT_DIRECT_SPEC",
          name,
          `${section} must use an exact semver version`,
        );
      }
    }
  }

  for (const entryPath of changedKeys) {
    const entry = lockfile.packages[entryPath];
    const name = packageName(entryPath, entry);

    if (entry.link === true) {
      addFinding(
        "high",
        "LOCAL_OR_WORKSPACE_LINK",
        name,
        "changed package resolves through a local or workspace link",
      );
      continue;
    }

    if (typeof entry.version !== "string" || !entry.version) {
      addFinding("high", "MISSING_VERSION", name, "changed package has no exact version");
    }

    if (typeof entry.resolved !== "string" || !entry.resolved) {
      addFinding("high", "MISSING_SOURCE", name, "changed package has no resolved source");
    } else {
      let resolved;
      try {
        resolved = new URL(entry.resolved);
      } catch {
        addFinding(
          "high",
          "UNSUPPORTED_SOURCE",
          name,
          "changed package source is not an HTTPS registry URL",
        );
      }
      if (resolved) {
        if (resolved.protocol !== "https:") {
          addFinding("high", "INSECURE_SOURCE", name, "resolved source does not use HTTPS");
        }
        if (!options.allowedHosts.has(resolved.hostname.toLowerCase())) {
          addFinding(
            "high",
            "UNAPPROVED_REGISTRY",
            name,
            `registry host ${resolved.hostname} is not allowlisted`,
          );
        }
        if (resolved.username || resolved.password) {
          addFinding(
            "high",
            "SOURCE_URL_CREDENTIALS",
            name,
            "resolved source URL contains embedded credentials",
          );
        }
        if (resolved.port && resolved.port !== "443") {
          addFinding(
            "high",
            "UNAPPROVED_REGISTRY_PORT",
            name,
            `registry uses non-default port ${resolved.port}`,
          );
        }
        if (!officialTarballMatches(resolved, name, entry.version)) {
          addFinding(
            "high",
            "TARBALL_PACKAGE_MISMATCH",
            name,
            "official-registry tarball path does not match package name and version",
          );
        }
      }
    }

    if (!hasSha512Integrity(entry.integrity)) {
      addFinding(
        "high",
        "MISSING_OR_WEAK_INTEGRITY",
        name,
        "changed package lacks sha512 integrity",
      );
    }

    if (entry.hasInstallScript === true) {
      addFinding(
        "high",
        "INSTALL_SCRIPT",
        name,
        "changed package declares executable install behavior",
      );
    }
    if (entry.bin !== undefined) {
      addFinding("medium", "PACKAGE_BINARY", name, "changed package exposes a binary");
    }
    if (entry.optional === true || entry.os !== undefined || entry.cpu !== undefined) {
      addFinding(
        "medium",
        "PLATFORM_OR_OPTIONAL_PACKAGE",
        name,
        "changed package has optional or platform-specific resolution",
      );
    }
  }

  if (
    baseline &&
    lockfile.lockfileVersion < baseline.lockfileVersion
  ) {
    addFinding(
      "high",
      "LOCKFILE_FORMAT_DOWNGRADE",
      "package-lock.json",
      "lockfileVersion decreased from the baseline",
    );
  }

  const currentCount = Object.keys(lockfile.packages).length - 1;
  const baselineCount = baseline
    ? Object.keys(baseline.packages).length - 1
    : 0;
  const packageIncrease = currentCount - baselineCount;
  if (
    baseline &&
    packageIncrease > Math.max(20, Math.ceil(Math.max(baselineCount, 1) * 0.25))
  ) {
    addFinding(
      "medium",
      "DEPENDENCY_COUNT_EXPLOSION",
      "package-lock.json",
      `resolved package count increased by ${packageIncrease}`,
    );
  }

  findings.sort((left, right) =>
    `${left.code}:${left.subject}`.localeCompare(`${right.code}:${right.subject}`),
  );

  const requiresReview =
    changedDirectSpecs > 0 ||
    changedKeys.size > 0 ||
    removedKeys.length > 0 ||
    findings.length > 0;
  const report = {
    tool: "npm-lockfile-preflight",
    status: requiresReview ? "review-required" : "clear-for-next-gate",
    code: requiresReview
      ? "PREFLIGHT_REVIEW_REQUIRED"
      : "PREFLIGHT_CLEAR_FOR_NEXT_GATE",
    nextAction: requiresReview
      ? findings.length > 0
        ? "Address every findings[].action, then continue with the required L1-L4 review stages. Do not execute dependency code yet."
        : "Review the changed dependency graph with the required L1-L4 stages. A mechanical change alone is not approval."
      : "Continue with any other required gate. This result is not a safety verdict.",
    scope: baseline ? "changed-lockfile-entries" : "entire-lockfile",
    registryAllowlist: [...options.allowedHosts].sort(),
    changes: {
      directSpecs: changedDirectSpecs,
      addedOrChanged: changedKeys.size,
      removed: removedKeys.length,
      currentPackageCount: currentCount,
      baselinePackageCount: baseline ? baselineCount : null,
    },
    findings,
    limitations: [
      "This result is deterministic preflight evidence, not a safety verdict.",
      "Tarball contents, malware intelligence, vulnerabilities, provenance, native code, and runtime behavior are not inspected here.",
    ],
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = requiresReview ? 1 : 0;
}

try {
  main();
} catch (error) {
  writeBlocked(error);
}
