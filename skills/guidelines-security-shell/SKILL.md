---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- One thing is gated: what cannot be got back. A killed server restarts, an image rebuilds, a workspace file is in git — that is ordinary work, so do it without weighing it. Losing the only copy of something is what needs a person.
- Deleting or writing outside the workspace asks first; reading anywhere does not. Overwriting counts as deleting, and a relative path is read from wherever a preceding `cd` left the shell.
- Refused outright, so do not spend a turn trying: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing a disk, `eval`, a bare shell, and any payload that only exists after expansion (`bash -c "$CMD"`, `| sh`). A literal `bash -c '…'` or `$( … )` is opened and judged as the command it carries. Report the need and stop — never reword a command until it passes, and never promote one to safe on your own reading of it.
- Prefer the spelling that needs no approval: an exact path inside the workspace, a `pkill` pattern naming one process rather than a runtime, `docker rm`/`rmi` rather than a volume, `pip install --only-binary=:all:` rather than a source build that runs `setup.py`. A gate that does fire names the safer form; read it instead of retrying.
- A refusal names the spelling that needs no approval; take it. When there is none, keep the step rather than reword it, finish what does not need one, and raise them together at the close through `AskUserQuestion`.
- This is a fast gate, not shell mediation. `ssh`, `adb shell`, and code reached by writing a script and then running it fall outside it and stay under these rules. Keep native permissions and sandboxing on.
- Installing the hook precedes use; when it is missing offer `guardrails-agent-plugin`, and install only with explicit consent. Never re-confirm what the hook already gates.
