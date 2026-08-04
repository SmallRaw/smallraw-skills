#!/usr/bin/env node

// Deterministic installer for the guidelines guard hooks.
//
// The agent runs this instead of reasoning about host internals: the host table,
// registration paths, matchers, and idempotency marker all live here. Detection
// never guesses — an ambiguous host is reported, not assumed.
//
//   --check     report the host and, per policy, one of not-registered /
//               registered-stale / registered (plus trust state when the host
//               has one). Scans every known registration point, not just the
//               detected host's, so an existing install is always found.
//   --install   idempotent upsert keyed on the marker; updates our own entry in
//               place and never appends a duplicate or creates a plugin.
//   --verify    self-test the guard+policy pipeline and print the exact in-session
//               commands that prove the host actually fires the hooks.
//
// Options: --host <name>  --dry-run  --json  --help

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MARKER = "guardrails";
const SKILL_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKILLS_DIR = path.dirname(SKILL_ROOT);
const GUARD = path.join(SKILL_ROOT, "scripts", "guard.mjs");

// Matchers are host-specific because tool names are. Keeping them here is the
// whole point: the model never has to know them.
const POLICIES = [
  {
    name: "guidelines-git",
    matchers: { "claude-code": "Bash", codex: "Bash", cursor: "Bash" },
  },
  {
    name: "guidelines-security-npm",
    matchers: { "claude-code": "Bash", codex: "Bash", cursor: "Bash" },
  },
  {
    name: "guidelines-security-shell",
    matchers: { "claude-code": "Bash", codex: "Bash", cursor: "Bash" },
  },
  {
    name: "guidelines-security-local",
    matchers: {
      "claude-code": "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|WebFetch",
      codex: "Bash|apply_patch|Edit|Write",
      cursor: "Bash|Read|Write|Edit",
    },
  },
];

const HOSTS = {
  "claude-code": {
    label: "Claude Code",
    configPath: () => path.join(os.homedir(), ".claude", "settings.json"),
    // Hooks live under a top-level "hooks" key in the settings file.
    container: (config) => config.hooks ?? (config.hooks = {}),
    installable: true,
    trust: null,
    detect: () =>
      process.env.CLAUDECODE === "1" || Boolean(process.env.CLAUDE_CODE_ENTRYPOINT),
  },
  codex: {
    label: "Codex",
    configPath: () =>
      path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json"),
    container: (config) => config.hooks ?? (config.hooks = {}),
    installable: true,
    // Codex records trust against the hook's current hash: any edit invalidates
    // it, and an untrusted hook does not run. Never report an install as active
    // without saying this.
    trust: "Run /hooks in Codex and trust the entry; editing a hook always invalidates prior trust.",
    detect: () => Boolean(process.env.CODEX_HOME) && !process.env.CLAUDECODE,
  },
  cursor: {
    label: "Cursor",
    configPath: () => path.join(os.homedir(), ".cursor", "hooks.json"),
    container: (config) => config.hooks ?? (config.hooks = {}),
    installable: true,
    // Cursor accepts Claude's nested hookSpecificOutput and maps PascalCase
    // event names itself, so the same guard output works unchanged. It does
    // fail open on a non-zero exit, so deny is also signalled with exit 2.
    denyExit: 2,
    trust: null,
    residualGap:
      "Cursor fails open if the hook process itself cannot start; native permissions stay the backstop for that case.",
    detect: () => Boolean(process.env.CURSOR_TRACE_ID) && !process.env.CLAUDECODE,
  },
  // Scanned for existing installs, but not written by this installer. Use the
  // matching reference doc instead of inventing a layout for these.
  "gemini-cli": {
    label: "Gemini CLI",
    configPath: () => path.join(os.homedir(), ".gemini", "settings.json"),
    installable: false,
  },
  windsurf: {
    label: "Windsurf",
    configPath: () => path.join(os.homedir(), ".codeium", "windsurf", "hooks.json"),
    installable: false,
  },
  kiro: {
    label: "Kiro",
    configPath: () => path.join(os.homedir(), ".kiro", "hooks.json"),
    installable: false,
  },
};

function policyPath(name) {
  return path.join(SKILLS_DIR, name, "scripts", "policy.mjs");
}

function markerFor(policyName) {
  return `${MARKER}:${policyName}`;
}

// `|| exit 2` is the fail-closed compensation, not decoration: hosts treat a
// non-2 exit as a non-blocking error and run the command anyway, so a guard
// that cannot start at all would silently wave everything through. The guard
// itself exits 0 for both allow and deny, so this fires only on a real crash.
function hookCommand(policyName, hostName) {
  const denyExit = HOSTS[hostName]?.denyExit;
  const suffix = denyExit ? ` --deny-exit ${denyExit}` : "";
  return `node ${JSON.stringify(GUARD)} ${JSON.stringify(policyPath(policyName))}${suffix} || exit 2`;
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, value: null };
    return { ok: false, error: error.message };
  }
}

// Our entries are identified by statusMessage, a schema-legal field, so no
// sidecar state or comment convention is needed to find them again.
function findEntry(container, policyName) {
  const groups = container.PreToolUse;
  if (!Array.isArray(groups)) return null;
  for (const [groupIndex, group] of groups.entries()) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const [hookIndex, hook] of hooks.entries()) {
      if (hook?.statusMessage === markerFor(policyName)) {
        return { groupIndex, hookIndex, group, hook };
      }
    }
  }
  return null;
}

function detectHost(explicit) {
  if (explicit) {
    if (!HOSTS[explicit]) {
      return { host: null, reason: `unknown-host: ${explicit}`, source: "flag" };
    }
    return { host: explicit, source: "flag" };
  }
  const byEnv = Object.keys(HOSTS).filter((name) => HOSTS[name].detect?.());
  if (byEnv.length === 1) return { host: byEnv[0], source: "environment" };
  if (byEnv.length > 1) {
    return { host: null, reason: `ambiguous-environment: ${byEnv.join(", ")}`, source: "environment" };
  }
  // Filesystem presence proves a host is installed, never that it is the one
  // running us. It yields a candidate that the caller must confirm.
  const candidates = Object.keys(HOSTS).filter((name) => fs.existsSync(HOSTS[name].configPath()));
  if (candidates.length === 1) {
    return { host: null, candidate: candidates[0], reason: "candidate-needs-confirmation", source: "filesystem" };
  }
  return {
    host: null,
    reason: candidates.length > 1 ? `ambiguous-filesystem: ${candidates.join(", ")}` : "unknown-host",
    source: "filesystem",
  };
}

function inspect() {
  const findings = [];
  for (const [name, host] of Object.entries(HOSTS)) {
    const file = host.configPath();
    const read = readJson(file);
    if (!read.ok) {
      findings.push({ host: name, file, state: "unreadable", detail: read.error });
      continue;
    }
    if (read.value === null) continue;
    const container = read.value.hooks ?? {};
    for (const policy of POLICIES) {
      const found = findEntry(container, policy.name);
      if (!found) continue;
      const expected = hookCommand(policy.name, name);
      findings.push({
        host: name,
        file,
        policy: policy.name,
        state: found.hook.command === expected ? "registered" : "registered-stale",
        matcher: found.group.matcher,
        command: found.hook.command,
      });
    }
    findings.push(...unmarkedRegistrations(container, name, file));
  }
  return findings;
}

// A registration this installer did not write is invisible to it: --install
// adds its own alongside, and every command then runs the same policy twice
// through two adapters. Where those adapters disagree the stricter one wins,
// which is how a confirm silently became a hard block. Report them; removing
// someone else's entry is the user's call, not this script's.
function unmarkedRegistrations(container, host, file) {
  const findings = [];
  for (const groups of Object.values(container)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of group?.hooks ?? []) {
        const command = hook?.command ?? "";
        if (String(hook?.statusMessage ?? "").startsWith(`${MARKER}:`)) continue;
        const policy = POLICIES.find((entry) =>
          command.includes(`${entry.name}/scripts/policy.mjs`),
        );
        if (!policy) continue;
        findings.push({
          host,
          file,
          policy: policy.name,
          state: "registered-unmarked",
          matcher: group?.matcher,
          command,
        });
      }
    }
  }
  return findings;
}

function checkCommand(hostInfo, asJson) {
  const findings = inspect();
  const missingPolicies = POLICIES.filter((p) => !fs.existsSync(policyPath(p.name))).map((p) => p.name);
  const registered = new Set(findings.filter((f) => f.state === "registered").map((f) => f.policy));
  const stale = new Set(findings.filter((f) => f.state === "registered-stale").map((f) => f.policy));

  const perPolicy = POLICIES.map((policy) => ({
    policy: policy.name,
    state: stale.has(policy.name)
      ? "registered-stale"
      : registered.has(policy.name)
        ? "registered"
        : "not-registered",
  }));

  const host = hostInfo.host ? HOSTS[hostInfo.host] : null;
  const report = {
    host: hostInfo.host,
    hostLabel: host?.label ?? null,
    detection: hostInfo.source,
    detectionNote: hostInfo.reason ?? null,
    candidate: hostInfo.candidate ?? null,
    installable: host?.installable ?? false,
    trustNote: host?.trust ?? null,
    residualGap: host?.residualGap ?? null,
    policies: perPolicy,
    existingRegistrations: findings,
    missingPolicyModules: missingPolicies,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Host: ${report.hostLabel ?? "UNRESOLVED"} (via ${report.detection})\n`);
    if (report.detectionNote) process.stdout.write(`  note: ${report.detectionNote}\n`);
    if (report.candidate) {
      process.stdout.write(`  candidate: ${report.candidate} — confirm with --host ${report.candidate}\n`);
    }
    for (const entry of perPolicy) process.stdout.write(`  ${entry.state.padEnd(18)} ${entry.policy}\n`);
    for (const finding of findings) {
      process.stdout.write(`  found in ${finding.host}: ${finding.policy} [${finding.state}] ${finding.file}\n`);
    }
    const unmarked = findings.filter((f) => f.state === "registered-unmarked");
    if (unmarked.length) {
      process.stdout.write(
        `\n  ${unmarked.length} registration(s) point at these policies but were not written here.\n` +
          "  Each one runs the same policy a second time through a different adapter; if they\n" +
          "  disagree the stricter verdict wins, so a confirm can surface as a hard block.\n" +
          "  Review and remove them before installing:\n",
      );
      for (const f of unmarked) {
        process.stdout.write(`    ${f.host}: ${f.policy}\n      ${f.command.slice(0, 120)}\n`);
      }
    }
    if (missingPolicies.length) {
      process.stdout.write(`  missing policy modules: ${missingPolicies.join(", ")}\n`);
    }
    if (report.trustNote) process.stdout.write(`  trust: ${report.trustNote}\n`);
  }
  // 0 = every policy registered and current; 1 = work to do; 2 = cannot resolve host.
  if (!report.host && !report.candidate) return 2;
  return perPolicy.every((entry) => entry.state === "registered") ? 0 : 1;
}

function installCommand(hostInfo, { dryRun, asJson }) {
  if (!hostInfo.host) {
    const message = {
      error: "unresolved-host",
      detail: hostInfo.reason ?? "unknown-host",
      candidate: hostInfo.candidate ?? null,
      nextAction: hostInfo.candidate
        ? `Re-run with --host ${hostInfo.candidate} once the user confirms that is the running host.`
        : "Ask the user which host is running, or follow the matching reference doc for an unlisted host.",
    };
    process.stdout.write(`${JSON.stringify(message, null, 2)}\n`);
    return 2;
  }
  const host = HOSTS[hostInfo.host];
  if (!host.installable) {
    process.stdout.write(
      `${JSON.stringify(
        {
          error: "host-not-installable-here",
          host: hostInfo.host,
          nextAction: `Use the ${host.label} reference doc; this installer only writes Claude Code and Codex layouts.`,
        },
        null,
        2,
      )}\n`,
    );
    return 2;
  }

  const file = host.configPath();
  const read = readJson(file);
  if (!read.ok) {
    process.stdout.write(`${JSON.stringify({ error: "unreadable-config", file, detail: read.error }, null, 2)}\n`);
    return 2;
  }
  const config = read.value ?? {};
  const container = host.container(config);
  if (!Array.isArray(container.PreToolUse)) container.PreToolUse = [];

  const actions = [];
  for (const policy of POLICIES) {
    if (!fs.existsSync(policyPath(policy.name))) {
      actions.push({ policy: policy.name, action: "skipped-missing-module" });
      continue;
    }
    const matcher = policy.matchers[hostInfo.host];
    const command = hookCommand(policy.name, hostInfo.host);
    const entry = {
      type: "command",
      command,
      statusMessage: markerFor(policy.name),
      timeout: 15,
    };
    const found = findEntry(container, policy.name);
    if (found) {
      // Update in place: same marker means this is our entry, so never append.
      const unchanged = found.hook.command === command && found.group.matcher === matcher;
      found.group.matcher = matcher;
      Object.assign(found.hook, entry);
      actions.push({ policy: policy.name, action: unchanged ? "unchanged" : "updated" });
      continue;
    }
    const group = container.PreToolUse.find(
      (candidate) => candidate?.matcher === matcher && Array.isArray(candidate.hooks),
    );
    if (group) group.hooks.push(entry);
    else container.PreToolUse.push({ matcher, hooks: [entry] });
    actions.push({ policy: policy.name, action: "installed" });
  }

  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (read.value !== null) fs.copyFileSync(file, `${file}.guardrails-backup`);
    fs.writeFileSync(file, serialized, "utf8");
  }

  const report = {
    host: hostInfo.host,
    file,
    dryRun: Boolean(dryRun),
    actions,
    backup: !dryRun && read.value !== null ? `${file}.guardrails-backup` : null,
    trustRequired: host.trust,
    residualGap: host.residualGap ?? null,
    nextAction: [
      host.trust,
      host.residualGap,
      "Restart the session so the host reloads its hook configuration.",
      "Then run this script with --verify and follow the printed in-session checks.",
    ]
      .filter(Boolean)
      .join(" "),
  };
  process.stdout.write(
    asJson ? `${JSON.stringify(report, null, 2)}\n` : formatInstall(report),
  );
  return 0;
}

function formatInstall(report) {
  const lines = [`${report.dryRun ? "[dry-run] " : ""}${report.file}`];
  for (const action of report.actions) lines.push(`  ${action.action.padEnd(24)} ${action.policy}`);
  if (report.backup) lines.push(`  backup: ${report.backup}`);
  lines.push(`  next: ${report.nextAction}`);
  return `${lines.join("\n")}\n`;
}

// Vectors chosen to be harmless to evaluate: the policies classify strings, and
// nothing here is ever executed.
const VECTORS = [
  { policy: "guidelines-git", command: "git status --short", expect: "allow" },
  { policy: "guidelines-git", command: "gh auth setup-git", expect: "deny" },
  { policy: "guidelines-security-npm", command: "npm test", expect: "allow" },
  { policy: "guidelines-security-npm", command: "npx cowsay hi", expect: "deny" },
  { policy: "guidelines-security-shell", command: "ls -la", expect: "allow" },
  { policy: "guidelines-security-shell", command: "sudo id", expect: "deny" },
  { policy: "guidelines-security-local", command: "cat README.md", expect: "allow" },
  { policy: "guidelines-security-local", command: "cat .env", expect: "deny" },
];

function verifyCommand(hostInfo, asJson) {
  const results = [];
  for (const vector of VECTORS) {
    const module = policyPath(vector.policy);
    if (!fs.existsSync(module)) {
      results.push({ ...vector, got: "missing-module", ok: false });
      continue;
    }
    const run = spawnSync(
      process.execPath,
      [GUARD, module],
      {
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: vector.command },
          cwd: process.cwd(),
        }),
        encoding: "utf8",
      },
    );
    let got = "allow";
    if (run.stdout.trim() !== "") {
      try {
        got = JSON.parse(run.stdout).hookSpecificOutput.permissionDecision;
      } catch {
        got = "unparseable";
      }
    }
    const expected = vector.expect === "confirm" ? "ask" : vector.expect;
    results.push({ ...vector, got, ok: got === expected });
  }

  const failed = results.filter((entry) => !entry.ok);
  const report = {
    pipeline: failed.length === 0 ? "ok" : "failed",
    results,
    // The script cannot make the host fire its own hooks; only an in-session
    // attempt proves that half, so hand the agent the exact checks to run.
    inSessionChecks: [
      "Run `git status --short` — it must run normally.",
      "Run `npx cowsay hi` — it must be blocked with [one-off-package-runner].",
      "Run `sudo id` — it must be blocked with [privilege-escalation].",
      "A block without a [rule-id] prefix came from some other layer, not these hooks.",
    ],
    trustNote: hostInfo.host ? HOSTS[hostInfo.host]?.trust ?? null : null,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of results) {
      process.stdout.write(
        `  ${entry.ok ? "ok  " : "FAIL"} ${entry.policy.padEnd(26)} ${entry.expect.padEnd(6)} ${entry.command}\n`,
      );
    }
    process.stdout.write(`pipeline: ${report.pipeline}\n`);
    for (const check of report.inSessionChecks) process.stdout.write(`  next: ${check}\n`);
    if (report.trustNote) process.stdout.write(`  trust: ${report.trustNote}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write(
      [
        "Deterministic installer for the guidelines guard hooks.",
        "",
        "  --check     report host and per-policy registration state",
        "  --install   idempotent upsert of every available policy",
        "  --verify    self-test the guard pipeline and print in-session checks",
        "",
        "  --host <name>  claude-code | codex (skip detection)",
        "  --dry-run      show what --install would write",
        "  --json         machine-readable output",
        "",
        "Exit codes: 0 done, 1 work remaining, 2 cannot proceed.",
      ].join("\n") + "\n",
    );
    return 0;
  }

  const asJson = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const hostIndex = argv.indexOf("--host");
  const explicitHost = hostIndex >= 0 ? argv[hostIndex + 1] : undefined;
  const hostInfo = detectHost(explicitHost);

  if (argv.includes("--install")) return installCommand(hostInfo, { dryRun, asJson });
  if (argv.includes("--verify")) return verifyCommand(hostInfo, asJson);
  return checkCommand(hostInfo, asJson);
}

process.exitCode = main();
