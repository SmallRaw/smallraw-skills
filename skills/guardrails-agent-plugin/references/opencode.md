# OpenCode Adapter

OpenCode uses a JavaScript or TypeScript plugin callback. Put project plugins in
`.opencode/plugins/` and global plugins in `~/.config/opencode/plugins/`, or register a
trusted npm plugin in `opencode.json`.

## Tool Adapter

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
unless the caller's policy explicitly requires it. Throwing blocks the tool, which is the
documented pattern for protected reads.

OpenCode does not expose the same generic `ask` output as Claude-compatible hooks. Use a
documented OpenCode permission or policy surface when the requested confirmation can be
represented there. Otherwise treat confirmation as deny and report the semantic gap; a
retry alone would evaluate and block the same operation again. Add a session-scoped,
single-use grant bound to the normalized operation only when the caller explicitly asks
for that mechanism.

`evaluateAndValidatePolicy` uses a bounded timeout and returns a valid deny for exceptions,
unknown decisions, or malformed blocks. Throw that deny through the callback so it fails
closed.

Keep this adapter separate from the policy so the same policy can also run through Open
Plugins or Pi.

Source: https://opencode.ai/docs/plugins/
