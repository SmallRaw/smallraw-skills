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
- Never escalate privileges, write block devices, or erase disks — report the need and stop.
- Do not wrap commands in `bash -c`, `eval`, or a nested shell to get past a gate; run the inner command directly so it can be classified.
- Never reach for these — they are refused outright: `sudo`/`su`, `shred`, `mkfs`, writing a block device, erasing or repartitioning a disk, and `bash -c`/`eval`/a bare shell. For everything else prefer the form that needs no approval: workspace-relative targets, a specific PID over a pattern kill, the inner command over a wrapper. A hook confirm cannot be pre-satisfied in conversation — do gated steps while the user is present, or leave them undone and report them.
- Keep native permissions and sandboxing on; this is a fast gate, not complete shell mediation, and these rules bind commands it cannot see, such as substitutions.
