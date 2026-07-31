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
- This gate is enforced by its guard hook, and installing it precedes use. Verify once per session, at the host's real hook registration point, that `scripts/policy.mjs` is registered as a pre-tool guard; if it is not, offer to install it and perform no gated operations until it is active. The hook gates acquisition only — the no-execution rules here bind even where it allows — and never re-confirm in conversation what it already gates.
- Until a scoped pass, do not execute lifecycle scripts, package binaries, project scripts, tests, generators, plugins, loaders, or an unreviewed installed tree.
- For dependency review, read [references/automation-routing.md](references/automation-routing.md), run its automated checks once after the edit is coherent, and obey stable codes and actions. Do not rescan after each small edit.
- Read [references/review-checklist.md](references/review-checklist.md) only for L1-L3/manual review and [references/incident-publishing.md](references/incident-publishing.md) only for publishing or suspected prior execution.
- Missing trusted coverage or isolation is **Blocked Pending Review**; never install a scanner ad hoc or fall back to host execution.
- Return only **Gate Passed for Scoped Use**, **Rejected**, or **Blocked Pending Review** for the exact package, version, source, graph, and intended operation.
- Invoke `guardrails-agent-plugin` with this policy module only to install or update its enforcement: offer it when the hook is missing, proceed solely with the user's explicit consent, and never invoke it during ordinary npm work.
