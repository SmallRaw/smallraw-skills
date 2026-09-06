---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- Recoverability draws the line. Moving an exact target to the operating system's Trash is ordinary work and does not ask, including outside the workspace; report what was moved and that it can be restored. Emptying Trash is permanent and stays blocked.
- A small permanent deletion inside a Git repository is ordinary work when every target is exact and the recursive impact is at most 20 existing filesystem entries. Pattern-selected, runtime-expanded, unreadable, larger, unversioned, workspace-root, and outside-workspace deletions use `trash <exact-path>` (or the platform's equivalent) instead. `rimraf`, `git rm`, and package-runner spellings receive the same judgment; `git clean`, `find -delete`, language filesystem APIs, and opaque cleanup scripts never bypass a blocked deletion.
- System trees are never a Git-workspace exception. Permanently deleting anything under operating-system roots such as `/System`, `/Library`, `/Applications`, `/usr`, `/etc`, `/var`, or `/private` is refused even when the current workspace or `cwd` points there.
- Ordinary writes to exact non-sensitive paths do not ask merely because they are outside the current workspace or repository; never reconfirm per directory, file, hunk, or tool call. Writes into operating-system trees or the Agent's own policy, hook, skill, and configuration surfaces may still ask, and `guidelines-security-local` continues to refuse privacy, credential, authentication-store, and command-history paths. Reading ordinary paths anywhere does not ask. A relative path is read from wherever a preceding `cd` left the shell.
- Refused outright, so do not spend a turn trying: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing a disk, `eval`, a bare shell, and any payload that only exists after expansion (`bash -c "$CMD"`, `| sh`). A literal `bash -c '…'`, `zsh -ic '…'`, or `$( … )` is opened and judged as the command it carries. Values passed as shell arguments stay data; an `xargs -I` replacement spliced into the `-c` source does not. Report the need and stop — never reword a command until it passes, and never promote one to safe on your own reading of it.
- Prefer the spelling that needs no approval: exact small deletions inside a Git repository, Trash for every other file or directory removal, ordinary writes directly into the target repository, a `pkill` pattern naming one process rather than a runtime, `docker rm`/`rmi` rather than a volume, `pip install --only-binary=:all:` rather than a source build that runs `setup.py`. A gate that does fire names the safer form; read it instead of retrying.
- A refusal names the spelling that needs no approval; take it. When there is none, keep the step rather than reword it, finish what does not need one, and raise them together at the close through `AskUserQuestion`.
- This is a fast gate, not shell mediation. `ssh`, `adb shell`, and code reached by writing a script and then running it fall outside it and stay under these rules. Keep native permissions and sandboxing on.
- Installing the hook precedes use; when it is missing offer `guardrails-agent-plugin`, and install only with explicit consent. Never re-confirm what the hook already gates.
