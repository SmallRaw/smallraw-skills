---
name: guidelines-git
description: Behavioral guidelines for Git mutations and GitHub write actions. Use when staging, committing, changing branches, rewriting history, pushing, creating pull requests, or posting comments, especially in dirty worktrees or repositories with directory-specific SSH identities.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Git

## 1. Authorization Boundaries

- Read-only inspection such as `status`, `diff`, `log`, `show`, and `blame` is allowed when relevant.
- A review-only request does not authorize mutations. Completed implementation may be committed automatically as one coherent, verified unit unless the user forbids commits.
- Pushes, branch changes, and history changes need separate authorization scoped to the repository, ref, operation, and current request.
- If "push", "publish", or "upload" could mean a deployment target, artifact registry, or Git remote, clarify the target first.

## 2. Preserve Existing State

- Inspect the branch, upstream, worktree, index, and relevant diffs before a mutation.
- Treat pre-existing changes as user-owned. Stage exact paths or hunks, never unrelated work.
- Do not use `stash`, `reset`, `restore`, `checkout --`, `clean`, `rebase`, history rewriting, or branch changes merely for convenience.
- Use a temporary worktree or clone when isolation is needed.
- Report unexpected Git state before attempting another mutation.

## 3. Commits, Pushes, and Identity

- Commit a completed problem and solution as one coherent unit, not each edit. Split only when independently meaningful or requested.
- Do not commit partial debugging or unverified experiments. Inspect the staged diff and follow the repository's message convention.
- Verify repository-local `user.name` and `user.email`; after committing, report the hash and remaining changes.
- Push only with explicit authorization. Verify the source ref, destination remote and branch, and commit range.
- Isolate approved history instead of pushing unrelated local commits.
- Force-pushing, deleting remote refs, moving tags, changing a default branch, publishing a release, or rewriting published history requires exact authorization.
- Use the current repository's push remote and SSH host alias. Different directories may use different identities; ask if configuration is missing, ambiguous, or inconsistent.
- Do not fall back to default `github.com` SSH, HTTPS credentials, tokens, another account, or default `gh`.
- Do not run `gh auth setup-git` or change credentials, remotes, or Git configuration to bypass authentication.
- If authentication or push fails, report it without retrying through another identity, protocol, remote, or credential source.
- After pushing, verify and report the remote branch and commit hash.
