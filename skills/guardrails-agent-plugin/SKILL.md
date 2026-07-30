---
name: guardrails-agent-plugin
description: Load when the prompt names `guardrails-agent-plugin`, or when a guidelines skill directs installing or updating its policy module as persistent enforcement; never infer invocation from the task alone.
user-invocable: true
disable-model-invocation: false
license: MIT
---

# Guardrails: Agent Plugin

Act as the hook implementation layer. The caller owns the domain policy; translate that
policy into the active Agent's native hook without replacing it with a capability catalog
or fixed `check`/`install` commands.

## Implement the Guardrail

1. Preserve the caller's exact allow, confirm, deny, preflight, and remediation semantics.
   Clarify only when a missing choice would materially change enforcement.
2. Detect the active Agent, requested scope, existing hook configuration, and reusable
   scripts. Read only the matching host reference below.
3. Choose the narrowest deterministic lifecycle event and matcher. Prefer a command or
   native callback over an LLM-backed prompt or agent hook.
4. Reuse a caller-provided policy module. If the caller supplies only rules, materialize
   them once as a host-neutral policy module; keep every host adapter limited to input
   normalization, policy invocation, and decision translation.
5. Give the policy a stable identity supplied by the caller or derived from domain Skill,
   policy name, and scope. Merge by that identity, preserving unrelated hooks and paths.
6. Strictly validate policy output. Errors, timeouts, unknown decisions, and malformed
   blocks must use the host's explicit blocking path where possible; report unavoidable
   fail-open behavior.
7. Use native confirmation when available. Otherwise treat `confirm` as `deny` and report
   the semantic gap unless the caller explicitly requests a session-scoped, single-use
   approval bound to the normalized operation. Never weaken `confirm` or `deny` to `allow`.
8. Verify the settled implementation once with harmless allow and block cases, then
   report the files, scope, active events, and residual coverage gaps.

## Host References

- Claude Code, Codex, Cursor, GitHub Copilot, or a Claude-compatible host:
  [references/open-plugins.md](references/open-plugins.md)
- Pi: [references/pi.md](references/pi.md)
- OpenCode: [references/opencode.md](references/opencode.md)

For an unlisted host, use its current official hook or plugin documentation and build a
thin adapter to the caller's policy. Do not infer wire formats from another Agent.

## Gotchas

- This Skill supplies hook mechanics, not Git, npm, secret, deployment, or database rules.
- Installing the same policy again must update or reuse its existing registration, not
  append a duplicate hook.
- Open Plugins standardizes packaging and events more than decision and failure semantics;
  test the actual host behavior.
- Retrying an unsupported `confirm` is not approval; without a native prompt or one-use
  grant it repeats the same block.
- A hook cannot enforce calls the host does not expose. Keep native permissions or sandbox
  controls when they cover paths the hook cannot see.
