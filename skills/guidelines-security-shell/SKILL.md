---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- Recoverability draws the line. Moving an exact target to the operating system's Trash is ordinary work and does not ask, including outside the workspace; report what was moved and that it can be restored. Emptying Trash is permanent and stays blocked.
- Before permanently deleting inside the workspace, pause for a self-check rather than asking the user: resolve the exact target, inspect a recursive or pattern-selected set first, and ask yourself whether this could be the only copy or the wrong path. If the answer is uncertain, use Trash. Once the target and scope are clear, delete it without asking.
- Permanent deletion outside the workspace, of the workspace root itself, or with a runtime-expanded/ambiguous target is refused rather than confirmable. Use `trash -- <exact-path>` (or the platform's equivalent) so recovery remains possible. Writing outside the workspace still asks first; reading anywhere does not. Overwriting counts as deleting, and a relative path is read from wherever a preceding `cd` left the shell.
- Refused outright, so do not spend a turn trying: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing a disk, `eval`, a bare shell, and any payload that only exists after expansion (`bash -c "$CMD"`, `| sh`). A literal `bash -c '…'`, `zsh -ic '…'`, or `$( … )` is opened and judged as the command it carries. Values passed as shell arguments stay data; an `xargs -I` replacement spliced into the `-c` source does not. Report the need and stop — never reword a command until it passes, and never promote one to safe on your own reading of it.
- Prefer the spelling that needs no approval: Trash for anything outside the workspace, a self-checked exact path for permanent workspace cleanup, a `pkill` pattern naming one process rather than a runtime, `docker rm`/`rmi` rather than a volume, `pip install --only-binary=:all:` rather than a source build that runs `setup.py`. A gate that does fire names the safer form; read it instead of retrying.
- A refusal names the spelling that needs no approval; take it. When there is none, keep the step rather than reword it, finish what does not need one, and raise them together at the close through `AskUserQuestion`.
- This is a fast gate, not shell mediation. `ssh`, `adb shell`, and code reached by writing a script and then running it fall outside it and stay under these rules. Keep native permissions and sandboxing on.
- Installing the hook precedes use; when it is missing offer `guardrails-agent-plugin`, and install only with explicit consent. Never re-confirm what the hook already gates.
