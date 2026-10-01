---
name: guidelines-security-npm
description: Check dependency acquisition, unfamiliar code execution, fetch-and-run commands and publishing across package managers. Skip routine manifest edits and trusted project scripts.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: npm Security

- Check package name/source/version; prefer exact versions and existing lockfiles. Disable install scripts. Task-scoped acquisition/lockfile updates with `--ignore-scripts` need no separate approval; routine manifest edits are ordinary work.
- Review dependency changes once for unexpected sources, invalid integrity or scripts. Normal project-source dependencies can proceed to project checks; version changes alone require neither full manual review nor a sandbox. Reject known malware/invalid integrity.
- Never fetch and execute unknown code together (`npx`/`dlx`/`create`, downloading `npm exec`, `uv run --with`, or equivalents). Trusted installed runners are ordinary execution; help/version flags do not prove safety.
- Disabled install scripts do not protect later imports/tests. Unfamiliar or suspicious code requires verified OS file/network isolation without accessible secrets before execution; approval is not proof of safety. Do not bypass with automatic fixes or another manager.
- Publishing/registry writes need exact package/version/destination authorization. Prepare reviewable output first; do not re-ask for authorized operations. Pause only blocked steps, continue independent work and collect remaining needs once at the close; silence is not approval.

Hooks are partial checks, not malware detection. Keep verified OS controls active; do not require/install scanners or hooks unless requested.

Only for requested audits or concrete anomalies: [automation](references/automation-routing.md), [manual review](references/review-checklist.md). For incidents/publishing: [reference](references/incident-publishing.md). Not routine prerequisites.
