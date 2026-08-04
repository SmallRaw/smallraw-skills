# OpenCode Adapter

OpenCode uses a JavaScript or TypeScript plugin callback rather than a command hook, so
`scripts/guard.mjs` does not apply.

Verified against the OpenCode plugin docs on 2026-08-04.

## Plugin Locations

Loaded in this order — the config files register a trusted npm plugin, the directories hold
local files:

1. `~/.config/opencode/opencode.json`
2. `opencode.json` (project)
3. `~/.config/opencode/plugins/`
4. `.opencode/plugins/`

## Tool Adapter

`tool.execute.before` is the equivalent of `PreToolUse`, and throwing from it blocks the
call. That is the documented way to stop a tool.

```ts
export const GuardrailsPlugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const decision = await evaluateAndValidatePolicy({
        tool: input.tool,
        input: output.args,
      });

      if (decision.decision === "allow") return;

      throw new Error(
        [decision.reason, decision.nextAction].filter(Boolean).join("\n"),
      );
    },
  };
};
```

The callback may inspect or deliberately rewrite `output.args`; do not rewrite arguments
unless the caller's policy explicitly requires it.

`evaluateAndValidatePolicy` uses a bounded timeout and returns a valid deny for exceptions,
unknown decisions, or malformed blocks. Throw that deny through the callback so it fails
closed.

## Confirmation

A `permission.ask` hook exists in the plugin API, so unlike a plain throw it can in
principle represent a confirmation rather than a refusal. **Do not rely on it without
testing the installed version**: as of this writing the project has open reports that the
hook is bypassed for first-encounter commands (`needsAsk=true`) and, separately, that it is
defined but never triggered. A confirmation that silently never fires is worse than one that
blocks, because the operation proceeds unreviewed.

Until it is verified on the installed version, degrade `confirm` to a thrown block and say
so in the install report — a `confirm` reported as enforced when it is not is the failure
this whole layer exists to prevent. Never weaken `confirm` or `deny` to allow.

Keep this adapter separate from the policy so the same policy can also run through Open
Plugins or Pi.

Sources:
- https://opencode.ai/docs/plugins/
- https://github.com/anomalyco/opencode/issues/7006
- https://github.com/anomalyco/opencode/issues/19927
