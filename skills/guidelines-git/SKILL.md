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
- Issue a gated write as its own command, never chained behind tests, builds, or other work. What the user sees in the approval prompt must be the operation being approved; a long chain hides the write and turns approval into a rubber stamp.
- Use repository-local identity, and the configured push remote with its directory-specific SSH alias.
- **HARD RULE — when the repository has its own SSH identity configured, that identity is the ONLY way anything reaches GitHub.** Push through it and nothing else. Never use `gh` to write, never comment, reply, review, open PRs or issues, never any other path or account. Never `gh auth setup-git`, HTTPS, tokens, or another account. Reading is fine; writing is not, no matter what was approved. If it cannot go through the repo's SSH identity, do not do it — report and stop.
- This gate is the guard hook; installing it precedes use. Verify once per session at the host's real registration point, and when it is missing offer `guardrails-agent-plugin` — install only with explicit consent, and if the user declines, fall back to checking each call against `scripts/policy.mjs` and confirming in conversation. Never re-confirm what the hook already gates.
- Keep native permissions and sandboxing on; this is a fast gate, not complete shell mediation, and these rules bind commands it cannot see.
- Stage exact paths so routine work needs no approval at all. In an unattended run, settle the pushes and history changes the task will need before starting it, rather than stalling on each one.
- After mutation, verify status and relevant refs and report the exact result.
