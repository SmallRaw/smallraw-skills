---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- This gate is the guard hook; installing it precedes use. Verify once per session at the host's real registration point, and when it is missing offer `guardrails-agent-plugin` — install only with explicit consent, and if the user declines, fall back to checking each call against `scripts/policy.mjs` and confirming in conversation. Never re-confirm what the hook already gates.
- One thing is gated: what cannot be got back. A killed server restarts, a deleted image rebuilds, a workspace file is in git — those are yours to do. Losing the only copy of something is what needs a person.
- Destruction needs a nameable target: state the exact paths and why they are yours to change. Workspace-internal cleanup is routine; system roots, devices, and the home directory itself are never targets. Relative paths are read from wherever a preceding `cd` left the shell, so `cd ../other-repo && rm -rf build` reaches outside this workspace and is gated accordingly.
- Refused outright: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing or repartitioning a disk, and `bash -c`/`eval`/a bare shell. Report the need and stop; never wrap a command to get it past a gate, and run the inner command directly so it can be classified.
- Installing from pip, cargo, go, gem, brew, or a system package manager fetches and runs third-party code. Name the package and why it is needed — no ecosystem outside npm has a review pipeline here, so the user is the review.
- Reach for the spelling that needs no approval first, rather than after a refusal. These pass on their own: deletion at an exact path inside the workspace or a temp dir, including `find … -delete` rooted there; a `pkill -f` pattern that identifies one process — a script name, a port, a flag fragment, `--headless` or another automation marker — where a bare runtime name like `node`, `python`, or `chrome` reaches the user's own work and does not; `docker rm`/`rmi`/`image prune`, since only `volume rm` and `system prune` touch data nothing else holds; `dd` with no `of=`, or an `of=` inside the workspace; a `chmod` on one path that is neither recursive nor world-writable.
- Batch what needs approval instead of interrupting for it. A run left to itself exists to reach the end unattended, and stopping it once per gated step defeats the reason it was started that way. Do everything that needs no approval, keep each gated step and what it would do, then close the turn by listing them and asking once — `AskUserQuestion` reaches the user in every permission mode. Run only what that answer covered. A hook confirm cannot be pre-satisfied in conversation, so the asking has to happen there, at the end.
- Never promote an operation to safe on your own reading of it. Judging a command obviously fine, or rewording one until it passes, is precisely the call this gate keeps with the user.
- Keep native permissions and sandboxing on; this is a fast gate, not complete shell mediation. It sees one local command at a time: substitutions, and anything sent to another machine through `ssh` or `adb shell`, run beyond its reach but still under these rules.
