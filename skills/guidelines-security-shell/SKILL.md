---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- This gate is the guard hook; installing it precedes use. Verify once per session at the host's real registration point, and when it is missing offer `guardrails-agent-plugin` — install only with explicit consent, and if the user declines, fall back to checking each call against `scripts/policy.mjs` and confirming in conversation. Never re-confirm what the hook already gates.
- Destruction needs a nameable target: state the exact paths and why they are yours to change. Workspace-internal cleanup is routine; system roots, devices, and the home directory itself are never targets.
- Refused outright: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing or repartitioning a disk, and `bash -c`/`eval`/a bare shell. Report the need and stop; never wrap a command to get it past a gate, and run the inner command directly so it can be classified.
- Installing from pip, cargo, go, gem, brew, or a system package manager fetches and runs third-party code. Name the package and why it is needed — no ecosystem outside npm has a review pipeline here, so the user is the review.
- Prefer the form that needs no approval: workspace-relative targets, a specific PID over a pattern kill, the inner command over a wrapper. A hook confirm cannot be pre-satisfied in conversation — do gated steps while the user is present, or leave them undone and report them.
- Keep native permissions and sandboxing on; this is a fast gate, not complete shell mediation. It sees one local command at a time: substitutions, and anything sent to another machine through `ssh` or `adb shell`, run beyond its reach but still under these rules.
