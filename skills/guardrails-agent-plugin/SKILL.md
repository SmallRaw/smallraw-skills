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

## For the Bundled Guidelines Policies, Run the Installer

Never hand-edit host configuration or create a plugin for these. `scripts/install-or-update.mjs`
owns the host table, registration paths, matchers, and the idempotency marker:

1. `node scripts/install-or-update.mjs --check` — reports the host and, per policy,
   `not-registered` / `registered-stale` / `registered`. It scans every known registration
   point, so an existing install is found even when host detection is uncertain.
2. Resolve the host before installing. The script never guesses: `UNRESOLVED` with a
   `candidate` means ask the user and re-run with `--host <name>`; `unknown-host` means ask
   which Agent is running or use a reference below. Do not infer the host from a config
   file's existence — that proves it is installed, not that it is running.
3. `node scripts/install-or-update.mjs --install` — idempotent upsert. It updates its own
   entries in place, preserves unrelated hooks, and writes a `.guardrails-backup` first.
   Exit 2 means it refused; read the reported `nextAction` instead of working around it.
4. Report the printed `nextAction` verbatim, including any trust step. **Registered is not
   active**: a host that records trust against the hook's hash needs a `/hooks` review, and
   editing a hook invalidates prior trust. A session restart is required either way.
5. `node scripts/install-or-update.mjs --verify` — self-tests the guard pipeline, then run
   the printed in-session checks. Only a real blocked command carrying a `[rule-id]` prefix
   proves the host fires the hooks; a block without one came from another layer.

Installable hosts are the ones whose blocking semantics were verified: Claude Code, Codex,
and Cursor. Every other host is scanned for an existing install but never written blindly —
a hook that registers and silently no-ops is worse than none, because it reads as protection.

## When the Installer Refuses

Only then: read [references/custom-policy.md](references/custom-policy.md) for the manual
procedure and the bar a new host must clear, plus the matching host reference —
[open-plugins.md](references/open-plugins.md) for Claude Code, Codex, Cursor, Copilot, and
other Claude-compatible hosts; [pi.md](references/pi.md); [opencode.md](references/opencode.md).
For an unlisted host use its own official documentation; never infer wire formats from
another Agent.

## Gotchas

- This Skill supplies hook mechanics, not Git, npm, secret, deployment, or database rules.
- Registered, trusted, and active are three different states. Treating "registered but not
  yet trusted" as "not installed" leads to duplicate installs and invented plugins.
- Installing the same policy again must update or reuse its existing registration, not
  append a duplicate hook.
- Open Plugins standardizes packaging and events more than decision and failure semantics;
  test the actual host behavior.
- Retrying an unsupported `confirm` is not approval; without a native prompt or one-use
  grant it repeats the same block.
- A hook cannot enforce calls the host does not expose. Keep native permissions or sandbox
  controls when they cover paths the hook cannot see.
