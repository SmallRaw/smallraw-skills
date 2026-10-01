---
name: guidelines-security-shell
description: Check privilege escalation, permanent deletion, system permissions/disks, broad process kills, container/volume destruction and dynamic shell execution. Skip ordinary reads, edits, tests and literal wrappers.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Shell Safety

- Prefer Trash. Only exact Git-workspace deletions of at most 20 existing entries may be permanent; use Trash otherwise and obey repository cleanup rules.
- Deny disk erasure, block-device writes, shredding, emptying Trash, permanent system-tree deletion, `sudo`/`su`, `eval`, opaque shell execution and downloaded code piped into a shell. Never bypass through another command/API/script.
- For permissions, process sweeps and container/volume destruction, check exact scope and authorization; prefer narrow targets. An exact operation already requested needs no repeat approval. System/agent-policy changes may still be gated.
- Ordinary non-sensitive cross-repository reads/writes/builds/tests need no extra question. Judge literal wrappers by their payload; arguments and source examples are data.
- Follow `guidelines-security-npm` for acquisition. Wheel-only registry/explicit-wheel pip installs need no package-name approval; direct source, editable and requirements inputs need checking.
- Pause only blocked steps, finish independent work, and collect remaining needs once at the close. Do not poll or treat silence as approval.

Hooks do not fully mediate scripts/subprocesses. Keep verified OS controls active; missing hooks do not block ordinary work. Install/update hooks only when explicitly requested.
