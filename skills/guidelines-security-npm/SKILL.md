---
name: guidelines-security-npm
description: npm supply-chain gate. Use for installing or materializing dependencies, graph/source changes, one-off package runners, first execution of untrusted package code, or npm publishing; skip unchanged trusted routine scripts.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: npm Security

- Treat every new or changed package version as untrusted executable code; clean evidence is not proof of safety, and `guidelines-security-local` remains binding.
- Apply this gate to dependency graph/source changes, one-off runners, first execution of an untrusted checkout, and publishing. Skip unchanged routine scripts only in an already trusted workspace.
- Before a relevant shell operation, pass the normalized tool call to `scripts/policy.mjs`; obey `deny`, ask on `confirm`, and follow `nextAction`. The script gates acquisition only; the no-execution rules here bind even where it allows.
- Until a scoped pass, do not execute lifecycle scripts, package binaries, project scripts, tests, generators, plugins, loaders, or an unreviewed installed tree.
- For dependency review, read [references/automation-routing.md](references/automation-routing.md), run its automated checks once after the edit is coherent, and obey stable codes and actions. Do not rescan after each small edit.
- Read [references/review-checklist.md](references/review-checklist.md) only for L1-L3/manual review and [references/incident-publishing.md](references/incident-publishing.md) only for publishing or suspected prior execution.
- Missing trusted coverage or isolation is **Blocked Pending Review**; never install a scanner ad hoc or fall back to host execution.
- Return only **Gate Passed for Scoped Use**, **Rejected**, or **Blocked Pending Review** for the exact package, version, source, graph, and intended operation.
- Only when asked to install or update persistent enforcement, invoke `guardrails-agent-plugin` with this policy module and these requirements; never invoke it during ordinary npm work.
