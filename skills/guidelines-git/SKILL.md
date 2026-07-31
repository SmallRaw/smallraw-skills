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
- Use repository-local identity and the configured push remote with its directory-specific SSH alias. Never fall back to default `github.com`, HTTPS, tokens, another account, default `gh`, or `gh auth setup-git`.
- **HARD RULE — when the repository has its own SSH identity configured, that identity is the ONLY way anything reaches GitHub.** Push through it and nothing else. Never use `gh` to write, never comment, reply, review, open PRs or issues, never any other path or account. Reading is fine; writing is not, no matter what was approved. If it cannot go through the repo's SSH identity, do not do it — report and stop.
- This skill's gate is its guard hook, and installing it precedes use. Verify once per session, at the host's real hook registration point, that `scripts/policy.mjs` is registered as a pre-tool guard; if it is not, offer to install it and perform no Git/GitHub shell writes until it is active. Never re-confirm in conversation what the hook already gates.
- Keep native permissions and sandboxing enabled; this policy is a fast gate, not complete shell mediation, and these rules still bind commands it cannot see, such as substitutions.
- After mutation, verify status and relevant refs and report the exact result.
- Invoke `guardrails-agent-plugin` with this policy module only to install or update its enforcement: offer it when the hook is missing, proceed solely with the user's explicit consent, and never invoke it for ordinary Git work.
