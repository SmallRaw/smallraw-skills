---
name: guidelines-git
description: Git and GitHub write rules. Use before staging, committing, changing branches or history, pushing, or writing through GitHub CLI.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Git

- Inspect branch, upstream, worktree, index, and relevant diffs; user changes are user-owned, so stage exact paths or hunks only.
- Review or diagnosis does not authorize writes. A completed requested change may become one coherent verified commit—not per-edit, debug, partial, or unrelated commits.
- Pushes and branch, history, remote, pull-request, or comment mutations need explicit authorization for the exact action.
- Use repository-local identity and the configured push remote with its directory-specific SSH alias. Never fall back to default `github.com`, HTTPS, tokens, another account, default `gh`, or `gh auth setup-git`.
- Before a Git/GitHub shell write, pass the normalized tool call to `scripts/policy.mjs`; obey `deny`, ask on `confirm`, and follow `nextAction`.
- Keep native permissions and sandboxing enabled; this policy is a fast gate, not complete shell mediation, and these rules still bind commands it cannot see, such as substitutions.
- After mutation, verify status and relevant refs and report the exact result.
- Only when asked to install or update persistent enforcement, invoke `guardrails-agent-plugin` with this policy module and these requirements; never invoke it for ordinary Git work.
