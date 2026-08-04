# OpenCode Adapter

OpenCode uses a plugin callback, not a command hook, so `scripts/guard.mjs` does not apply.
Checked against the plugin docs on 2026-08-04.

Plugins load from `~/.config/opencode/opencode.json`, project `opencode.json`,
`~/.config/opencode/plugins/`, then `.opencode/plugins/`.

`tool.execute.before` is the `PreToolUse` equivalent, and throwing from it blocks the call.

```ts
export const GuardrailsPlugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const decision = await evaluateAndValidatePolicy({
        tool: input.tool,
        input: output.args,
      });
      if (decision.decision === "allow") return;
      throw new Error([decision.reason, decision.nextAction].filter(Boolean).join("\n"));
    },
  };
};
```

The callback can rewrite `output.args`; don't, unless the policy requires it.
`evaluateAndValidatePolicy` turns exceptions, unknown decisions, and malformed blocks into a
deny, thrown the same way so it fails closed.

A `permission.ask` hook exists, so a `confirm` could in principle reach the user. Do not use
it untested: the project has open reports that it is bypassed for first-encounter commands
([#19927](https://github.com/anomalyco/opencode/issues/19927)) and that it never fires
([#7006](https://github.com/anomalyco/opencode/issues/7006)). A confirmation that silently
no-ops is worse than a block, because the operation proceeds unreviewed. Until verified on
the installed version, throw instead and report the degradation.

Keep the adapter separate from the policy so the same policy also runs through Open Plugins
or Pi.

Source: https://opencode.ai/docs/plugins/
