---
name: guidelines-security-npm
description: npm supply-chain gate. Use for installing or materializing dependencies, graph/source changes, one-off package runners, first execution of untrusted package code, or npm publishing; skip unchanged trusted routine scripts.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: npm Security

The risk is code that runs while a package arrives, or the first time one is used.
Fetching is gated; not executing until reviewed is on you, because no hook can see it.

- Treat every new or changed package version as untrusted executable code — clean evidence is not proof of safety, and `guidelines-security-local` stays binding. Until a scoped pass, do not run lifecycle scripts, package binaries, project scripts, tests, generators, plugins, loaders, or an unreviewed installed tree.
- Refused outright: fetching and running in one step (`npx pkg@version`, `dlx`, `create`, `npm exec`), an install without `--ignore-scripts`, `npm audit fix`, manifest rewrites via `npm pkg set`, and corepack acquiring a package manager. A runner resolving to an already installed binary fetches nothing and is fine — `npx tsc` is `node_modules/.bin/tsc` spelled differently.
- Help and version reports run nothing and pass, including a manager reached through `corepack`. The standard environment equivalents of `--ignore-scripts` count as scripts disabled; they do not make a mutable dependency resolution immutable.
- Restoring a committed lockfile needs no approval, so reach for that spelling whenever the intent is to materialize what is already there: `npm ci --ignore-scripts`, or `yarn install --immutable --ignore-scripts`. They fail rather than resolve anything new. A plain `install --ignore-scripts` re-resolves `package.json` and can land a version the lockfile never named, which is the moment worth settling while the user is present.
- Reading a package before trusting it is free: `npm pack --ignore-scripts <pkg>` downloads the tarball without installing or executing. Use it rather than installing to look.
- For dependency review, read [references/automation-routing.md](references/automation-routing.md) and run its checks once after the edit is coherent, obeying stable codes rather than message text. [references/review-checklist.md](references/review-checklist.md) is for L1-L3 manual review, [references/incident-publishing.md](references/incident-publishing.md) for publishing or suspected prior execution. Missing coverage or isolation blocks the package pending review; never install a scanner ad hoc.
- State the verdict for the exact package, version, source, graph, and intended operation — passed for that scope, rejected, or blocked — and never widen it beyond what was reviewed.
- A refusal names the spelling that needs no approval; take it. When there is none, keep the step rather than reword it, finish what does not need one, and raise them together at the close through `AskUserQuestion`.
- Installing the hook precedes use; when it is missing offer `guardrails-agent-plugin`, and install only with explicit consent. It gates acquisition only, so the no-execution rules above bind even where it allows.
