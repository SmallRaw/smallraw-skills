---
name: guidelines-git
description: Git and GitHub write rules. Use before staging, committing, changing branches or history, pushing, or writing through GitHub CLI.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Git

Two things are gated, and nothing else: reaching GitHub as the wrong identity, and losing
or force-changing code that cannot be recovered. Ordinary Git work is ordinary work.

- Inspect branch, upstream, worktree, index, and relevant diffs; user changes are user-owned, so stage exact paths or hunks only — which also keeps routine staging free of approvals.
- Review or diagnosis does not authorize writes. Commit each completed change as one coherent verified unit, as often as the work produces them — never per-edit, debug, partial, or unrelated commits.
- Issue a gated write as its own command, never chained behind tests, builds, or other work. What the user sees in the approval prompt must be the operation being approved; a long chain hides the write and turns approval into a rubber stamp.
- Use repository-local identity, and the configured push remote with its directory-specific SSH alias.
- **HARD RULE — when the repository has its own SSH identity configured, that identity is the ONLY way anything reaches GitHub.** Push through it and nothing else. Never use `gh` to write, never comment, reply, review, open PRs or issues, never any other path or account. Never `gh auth setup-git`, HTTPS, tokens, or another account. Reading is fine; writing is not, no matter what was approved. If it cannot go through the repo's SSH identity, do not do it — report and stop.
- This gate is the guard hook; installing it precedes use. Verify once per session at the host's real registration point, and when it is missing offer `guardrails-agent-plugin` — install only with explicit consent, and if the user declines, fall back to checking each call against `scripts/policy.mjs` and confirming in conversation. Never re-confirm what the hook already gates.
- Keep native permissions and sandboxing on; this is a fast gate, not complete shell mediation, and these rules bind commands it cannot see.
- A hook confirm cannot be pre-satisfied in conversation. For unattended work, finish gated steps while the user is present or leave them; never seek a way around the prompt.
- After a mutation, check it landed as intended. Mention unfinished or unpushed work once, when it is genuinely the user's next step — never as a status line appended to every reply.
