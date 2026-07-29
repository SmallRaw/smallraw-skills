---
name: guidelines-security-npm
description: Mandatory npm supply-chain gate when adding, updating, removing, resolving, downloading, or installing JavaScript dependencies; accepting lockfile changes; running npx, npm exec, pnpm dlx, yarn dlx, or bunx; first executing package code from an untrusted checkout; or publishing an npm package. Do not use for routine scripts in a user-owned trusted workspace when package manifests, the lockfile, the installed tree, and package-manager security configuration are unchanged in the current task.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: NPM Supply-Chain Security

Treat every new or changed package as untrusted executable code. Reputation, popularity, signatures, provenance, audits, and clean scans are supporting evidence, not proof of safety.

`guidelines-security-local` remains binding throughout this workflow. If it is unavailable, preserve the same prohibition on accessing or exposing local credentials and protected data.

## 1. Scope the Gate

Apply this gate to direct, transitive, development, optional, peer, bundled, Git, URL, file, directory, tarball, CLI, plugin, loader, generator, and build-tool dependencies.

Do not run the full gate for a routine `npm run`, test, lint, or build when all are true:

- the workspace is pre-existing and user-owned or otherwise explicitly trusted, not a newly downloaded untrusted checkout;
- package manifests and the lockfile are unchanged from the user's starting state;
- the installed dependency tree existed before the current task and no installation or resolution is required;
- no package-manager, registry, script-approval, or dependency-source configuration changed.

If any condition is unknown, apply the gate.

## 2. Stop Execution Before Review

Until the gate passes:

- do not execute dependency lifecycle scripts, package binaries, project scripts, tests, generators, bundlers, linters, plugins, or loaders supplied by the unreviewed tree;
- do not use `npx`, `npm exec`, `pnpm dlx`, `yarn dlx`, `bunx`, automatic confirmation flags, global installation, `sudo`, pipe-to-shell installers, forceful audit fixes, or blanket script approvals;
- do not run an untrusted package merely to learn what it does.

Metadata queries, lockfile-only resolution, tarball acquisition, and static inspection are allowed only with script execution disabled and inside the isolated review environment.

## 3. Isolate the Review

Use a disposable non-root environment with:

- a temporary clean home and explicit empty package-manager configuration;
- no host home mount, protected local files, tokens, SSH/GPG agents, browser profile, wallet, credential helper, Docker socket, or production data;
- controlled network egress and bounded CPU, memory, process count, file count, and disk use;
- only the minimum project inputs, normally `package.json`, the relevant lockfile, and selected non-secret source files.

If required isolation cannot be enforced, return `Blocked Pending Review`. Do not fall back to host execution.

## 4. Preflight Sequence

Perform the sequence without executing package code:

1. **Pin the source** — require the exact package, version, registry, tarball URL, and integrity. Reject HTTP, unexpected registries, moving tags or branches, broad ranges, and unapproved Git, URL, file, or directory dependencies.
2. **Check release context** — normally require a seven-day release cooldown. Review publication time, maintainers and ownership changes, repository changes, release cadence, size, files, scripts, binaries, native artifacts, and bundled dependencies.
3. **Resolve lockfile only** — disable scripts, save the exact version, and inspect every dependency, version, integrity, registry, source, alias, optional package, and unrelated change in the resulting lockfile diff.
4. **Scan the complete graph** — use current, already trusted malware and vulnerability data. A malware match, relevant unresolved critical vulnerability, scanner failure, or incomplete resolution blocks the gate.
5. **Inspect the published artifact** — acquire the exact tarball without scripts, verify its digest, inspect archive structure safely, and scan the extracted artifact rather than relying only on its source repository.
6. **Review executable behavior** — inspect lifecycle scripts, entry points, binaries, native code, WASM, generated or minified output, environment access, child processes, filesystem reach, network destinations, persistence behavior, and obfuscation.
7. **Compare and verify** — compare against the previously reviewed version and check available signatures and provenance. Invalid integrity, signatures, or attestations reject the package; missing provenance remains an explicit limitation.

Use [references/review-checklist.md](references/review-checklist.md) when carrying out this sequence.

## 5. Installation and Runtime Testing

After preflight passes:

- install the exact reviewed lockfile in a fresh disposable environment with scripts and binary links disabled;
- approve a required install script only for the exact reviewed package version, then run it separately with no credentials, restricted writes, and network disabled by default;
- run tests or package CLIs only in a disposable environment with synthetic data, restricted inputs and outputs, resource limits, and blocked or recorded network access;
- discard the environment afterward and do not move suspicious caches or `node_modules` onto a trusted host.

Every changed package version requires a new review.

## 6. Decision

Return exactly one scoped result:

- **Gate Passed for Scoped Use** — all mandatory stages completed for the named package, version, registry, lockfile, and intended operation, with limitations reported.
- **Rejected** — malicious behavior, compromised versions, invalid integrity, prohibited sources, archive attacks, or unexplained high-risk behavior was found. Do not execute the package.
- **Blocked Pending Review** — isolation, scanners, safe extraction, credentials, provenance, or meaningful review was unavailable or incomplete.

Never describe a package as safe merely because no scanner reported an alert.

For publishing or suspected prior execution, read [references/incident-publishing.md](references/incident-publishing.md).

## Gotchas

- `npx` and other one-off runners download or execute packages; they are not harmless inspection commands.
- Package tests are executable code and cannot be used as preflight inspection.
- A clean repository does not prove that the registry tarball contains the same code.
- Installing a scanner to inspect an untrusted package creates another dependency decision. Use an already trusted scanner or stop.
- Private package names and dependency metadata must not leak to an unauthorized public registry or scanner.
