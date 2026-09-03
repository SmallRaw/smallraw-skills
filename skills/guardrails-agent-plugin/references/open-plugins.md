# Open Plugins and Claude-Compatible Hosts

Checked against each host's own documentation on 2026-09-03; a capability claim is only as
current as that date. Re-check before relying on one, and never carry it over from another
Agent.

> Read this only when installing a policy the bundled installer does not cover, or on a
> host it refuses. For the bundled guidelines policies, `scripts/install-or-update.mjs`
> already encodes these paths and matchers — packaging a new plugin is the wrong move when
> a user-level registration already exists.

Use this route for Claude Code, Codex, Cursor, GitHub Copilot, and hosts that explicitly
support Claude-compatible hooks. Open Plugins is the packaging layer; host behavior still
decides the final tool names, decisions, timeouts, and failure mode.

## Package Shape

Prefer one shared implementation:

```text
guardrail-plugin/
├── .plugin/plugin.json
├── hooks/hooks.json
├── scripts/
│   └── guard.mjs
└── skills/
```

This repository ships a reusable Claude-compatible adapter at
`skills/guardrails-agent-plugin/scripts/guard.mjs` (argv: policy module path; allow is
silent so native permissions stay authoritative). Reuse it instead of generating a new
adapter for hosts that accept this hook shape.

Claude Code marketplace entries accept hooks only as an inline object, not a file path
(verified against a real install: the file-path form fails the plugin load). This
repository therefore inlines each guidelines plugin's hooks in
`.claude-plugin/marketplace.json`; the per-skill `hooks/hooks.json` files carry the same
configuration in the portable shape for other hosts. Keep both in sync when changing a
matcher or command.

Add a vendor manifest only when the target host requires one, such as
`.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`. Point every manifest and hook
entry at the same scripts; do not fork the policy.

Use `${PLUGIN_ROOT}` for portable internal paths. Use a documented vendor alias only when
the host does not expand the neutral placeholder.

Give each installed policy a stable ID supplied by the caller or derived from
`<domain-skill>:<policy>:<scope>`. Use it for filenames, configuration markers, and update
lookup so reinstalling replaces the same registration.

## Hook Shape

The portable tool event is `PreToolUse`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/scripts/guard.mjs\""
          }
        ]
      }
    ]
  }
}
```

Command hooks receive JSON on stdin. Normalize only fields the policy needs:

```json
{
  "hook_event_name": "PreToolUse",
  "cwd": "/workspace",
  "tool_name": "Bash",
  "tool_input": {}
}
```

For the widest command-hook compatibility:

- keep the entry script executable with a shebang, even when a host invokes it through
  its runtime;
- allow with exit `0` and no output when no host-specific override is required;
- deny with an explicit reason and the host's documented deny JSON or blocking exit code;
- translate confirmation with the host-specific mechanism rather than inventing a common
  value.

## Host Differences

| Host | Configuration and mapping | Important limit |
| --- | --- | --- |
| Claude Code | User/project settings or plugin `hooks/hooks.json`; `PreToolUse` supports `allow`, `deny`, `ask`, and `defer`. | Hooks run with the user's environment and credentials. |
| Codex | `~/.codex/hooks.json` (or `$CODEX_HOME`), project `<repo>/.codex/hooks.json`, or inline in `config.toml`. `PreToolUse` matches `Bash`, `apply_patch`/`Edit`/`Write`, and MCP tool names. `allow` and `deny` are supported; `ask` is parsed but not yet supported. On macOS this adapter handles `confirm` with a synchronous `Codex 安全确认` system dialog for the current tool invocation. | Hooks are on by default but **untrusted until reviewed**: Codex records trust against the hook's current hash, so any edit invalidates it and `/hooks` review is required again. A registered-but-untrusted hook does not run — it is not the same as "not installed". No GUI, missing invocation identity, rejection, or timeout denies. |
| Cursor | Native `.cursor/hooks.json`, or load Claude hooks when third-party compatibility is enabled. It accepts Claude's nested output and maps Claude tool names. | Native hook failures may be fail-open unless the relevant hook is configured to fail closed. |
| GitHub Copilot | Repository `.github/hooks/*.json`, user hooks, or a plugin. PascalCase `PreToolUse` selects Claude-compatible fields and matcher semantics. | Cloud runs cannot answer `ask`; command-hook timeouts are fail-open. |
| Factory Droid | User/project `.factory/hooks.json` or plugin hook; Claude-style input/output and plugin-root aliases are supported. | It is Claude-compatible but is not a substitute for verifying Open Plugins discovery on the installed version. |

When a host supports both a generic `PreToolUse` and a narrower shell, read, or edit event,
choose the narrowest event that still covers the caller's policy. Do not attach a heavy
scanner to every tool when only package-manager commands require it.

## Decision Translation

Keep the domain policy host-neutral:

```json
{
  "decision": "allow | confirm | deny",
  "reason": "human-readable explanation",
  "ruleId": "stable-rule-id",
  "nextAction": "specific remediation"
}
```

Translate at the edge:

- Claude Code: `confirm` becomes native `ask`.
- Codex `PreToolUse`: never emit unsupported `ask`. On macOS the bundled adapter blocks the
  current hook process on a system dialog and allows only when the user clicks `允许一次`.
  It writes no reusable grant. Rejection, timeout, missing invocation identity, no GUI, or
  another platform becomes an explicit deny carrying a `[codex-confirm-*]` reason.
- Codex `PermissionRequest`: map `deny` to deny; return no decision for `allow` or
  `confirm` so the native approval prompt remains authoritative.
- Cursor: use `ask` only where that event supports it; otherwise deny and report the gap.
- GitHub Copilot cloud: `confirm` must block because no user is present.
- A hard `deny` remains a deny on every host.

Validate the object before translation: only the three listed decisions are valid, and
`confirm` or `deny` requires a non-empty reason. A policy exception, timeout, or invalid
object must take the host's explicit blocking path. If the host itself forces hook
timeouts to fail open, report that path as unenforced.

If the caller explicitly requires confirmation on a host without `ask`, prefer a synchronous
user-presence prompt bound to the live invocation, like the bundled macOS Codex dialog. If a
host cannot do that and a grant is requested instead, it must be short-lived, single-use, and
bound to the session plus a normalized operation fingerprint. Do not use a broad or persistent
bypass.

## Sources

- Open Plugins specification: https://open-plugins.com/plugin-builders/specification
- Open Plugins hooks: https://open-plugins.com/agent-builders/components/hooks
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Codex hooks: https://developers.openai.com/codex/hooks
- Cursor third-party hooks: https://cursor.com/docs/reference/third-party-hooks
- GitHub Copilot hooks: https://docs.github.com/en/copilot/reference/hooks-reference
- Factory hooks: https://docs.factory.ai/harness/hooks
