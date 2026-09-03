---
name: guidelines-git
description: Git and GitHub write rules. Use before staging, committing, changing branches or history, pushing, or writing through GitHub CLI.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Git

Two things are gated, and nothing else: reaching GitHub as the wrong identity, and
losing or publishing what cannot be taken back. Ordinary Git work is ordinary work.

- **HARD RULE — when the repository has its own SSH identity configured, that identity is the ONLY way anything reaches GitHub.** Push through it and nothing else. Never use `gh` to write — no comments, reviews, PRs, issues, releases — and never `gh auth setup-git`, HTTPS, tokens, or another account. Reading is fine; writing is not, no matter what was approved. If it cannot go through the repo's SSH identity, report and stop — and never promote an operation to safe on your own reading of it.
- Four spellings drop work git cannot find again, and they are the only local ones gated: a pathspec `checkout` or `restore`, `git clean`, a `reset` that rewrites the working tree, and `worktree remove --force` or `submodule deinit --force`. Stash first if the changes might still be wanted; run `git clean -n` before the real one.
- Everything else in the loop passes on its own — staging, committing, applying a patch, taking a side of a conflict, moving between branches, deleting or renaming a branch or tag, and any history the reflog remembers. Stage exact paths because it makes a reviewable commit, not because a gate is watching.
- Reading Git configuration is free. A persistent change to identity, signing, transport, credentials, hooks, or aliases asks first; a user-wide config write asks because it affects other repositories, while a system-wide write is refused. Ordinary repository settings and command-scoped `git -c` overrides are recoverable local work and pass.
- Review or diagnosis does not authorize writes. Commit each completed change as one coherent verified unit — never per-edit, debug, partial, or unrelated commits — and afterwards check it landed as intended.
- A request to push is the confirmation for one ordinary push to the verified destination; execute it without asking the user again. A request to change or finish local work does not imply publication. Force-pushing still needs an explicit force-push request and any native confirmation the host can present.
- Issue a push or any other gated write as its own command, never chained behind tests or builds, so its destination and effect stay visible.
- A refusal names the safe spelling when one exists; take it. When there is none, keep the step rather than rewording it, finish independent work, and ask only for the missing decision — never offload an ordinary supported operation to the user.
- Installing the hook precedes use; when it is missing offer `guardrails-agent-plugin`, and install only with explicit consent. Never re-confirm what the hook already gates. Keep native permissions and sandboxing on — this is a fast gate, and these rules bind the commands it cannot see.
