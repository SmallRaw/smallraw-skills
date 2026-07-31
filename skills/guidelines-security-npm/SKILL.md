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
- This gate is the guard hook; installing it precedes use. Verify once per session at the host's real registration point, and when it is missing offer `guardrails-agent-plugin` — install only with explicit consent, and if the user declines, fall back to checking each call against `scripts/policy.mjs` and confirming in conversation. It gates acquisition only, so the no-execution rules below bind even where it allows; never re-confirm what it already gates.
- Until a scoped pass, do not execute lifecycle scripts, package binaries, project scripts, tests, generators, plugins, loaders, or an unreviewed installed tree.
- Never reach for these — they are refused outright: one-off runners (`npx`, `bunx`, `dlx`, `create`), `npm audit fix`, manifest rewrites via `npm pkg set`, and corepack acquiring a package manager. Use an installed binary under `node_modules/.bin` or a package script instead. Installing needs `--ignore-scripts` merely to become askable, so plan it while the user is present rather than mid-run; a hook confirm cannot be pre-satisfied in conversation.
- For dependency review, read [references/automation-routing.md](references/automation-routing.md), run its automated checks once after the edit is coherent, and obey stable codes and actions. Do not rescan after each small edit.
- Read [references/review-checklist.md](references/review-checklist.md) only for L1-L3/manual review and [references/incident-publishing.md](references/incident-publishing.md) only for publishing or suspected prior execution.
- Missing trusted coverage or isolation blocks the package pending review; never install a scanner ad hoc or fall back to host execution.
- State the verdict for the exact package, version, source, graph, and intended operation — passed for that scope, rejected, or blocked pending review — and never widen it beyond what was reviewed.
