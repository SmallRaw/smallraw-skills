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
- Refused outright: fetching and running a package in one step (`npx pkg@version`, `dlx`, `create`, `npm exec`), `npm audit fix`, manifest rewrites via `npm pkg set`, and corepack acquiring a package manager. A runner that resolves to an already installed binary fetches nothing and is fine — `npx tsc` is `node_modules/.bin/tsc` spelled differently.
- Restoring a committed lockfile is not a supply-chain decision and needs no approval: `npm ci --ignore-scripts`, or `yarn install --immutable --ignore-scripts` / `--frozen-lockfile`, fail rather than resolve anything new, so what lands is what the reviewed lockfile already named. Reach for that spelling whenever the intent is to materialize dependencies as they stand.
- A plain `install --ignore-scripts` re-resolves `package.json` and can land a version the lockfile never named, so it stays gated — that is the moment the graph actually changes, and it is worth settling while the user is present. Without `--ignore-scripts` an install is refused outright.
- Reading a package before trusting it is free: `npm pack --ignore-scripts <pkg>` downloads the tarball without installing or executing anything. Use it rather than installing to look.
- Batch what needs approval instead of interrupting for it. A run left to itself exists to reach the end unattended, and stopping it once per install or publish defeats the reason it was started that way. Do everything that needs no approval, keep each gated step and what it would do, then close the turn by listing them and asking once — `AskUserQuestion` reaches the user in every permission mode. Run only what that answer covered. A hook confirm cannot be pre-satisfied in conversation, so the asking has to happen there, at the end.
- Never promote an operation to safe on your own reading of it. Judging a package obviously fine, or rewording an install until it passes, is precisely the call this gate keeps with the user.
- For dependency review, read [references/automation-routing.md](references/automation-routing.md), run its automated checks once after the edit is coherent, and obey stable codes and actions. Do not rescan after each small edit.
- Read [references/review-checklist.md](references/review-checklist.md) only for L1-L3/manual review and [references/incident-publishing.md](references/incident-publishing.md) only for publishing or suspected prior execution.
- Missing trusted coverage or isolation blocks the package pending review; never install a scanner ad hoc or fall back to host execution.
- State the verdict for the exact package, version, source, graph, and intended operation — passed for that scope, rejected, or blocked pending review — and never widen it beyond what was reviewed.
