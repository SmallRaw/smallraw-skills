---
name: guidelines-security-shell
description: Destructive-shell gate. Use before privilege escalation, deletion or permission changes beyond the workspace, disk or device operations, pattern-based process killing, container or volume destruction, or shell indirection such as `bash -c` and `eval`.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- This gate is enforced by its guard hook, and installing it precedes use. Verify once per session, at the host's real hook registration point, that `scripts/policy.mjs` is registered as a pre-tool guard; if it is not, offer to install it and avoid gated destructive operations until it is active. Never re-confirm in conversation what the hook already gates.
- Destruction needs a nameable target: state the exact paths and why they are yours to change. Workspace-internal cleanup is routine; system roots, devices, and the home directory itself are never targets.
- Never escalate privileges, write block devices, or erase disks — report the need and stop.
- Do not wrap commands in `bash -c`, `eval`, or a nested shell to get past a gate; run the inner command directly so it can be classified.
- Keep native permissions and sandboxing enabled; this policy is a fast gate, not complete shell mediation, and these rules still bind commands it cannot see, such as substitutions.
- Invoke `guardrails-agent-plugin` with this policy module only to install or update its enforcement: offer it when the hook is missing, proceed solely with the user's explicit consent, and never invoke it during ordinary shell work.
