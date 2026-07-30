# Pi Adapter

Pi uses an in-process TypeScript extension rather than a command-based `PreToolUse` hook.
Keep the policy host-neutral and make the extension a thin translator.

## Location

- User: `~/.pi/agent/extensions/*.ts` or a subdirectory with `index.ts`
- Project: `.pi/extensions/*.ts` or a subdirectory with `index.ts`
- Package: install a trusted npm extension through Pi

Project extensions load only after project trust. Use `pi -e ./path/to/extension.ts` for an
isolated test and `/reload` after changing an installed extension.

## Tool Adapter

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const decision = await evaluateAndValidatePolicy({
      cwd: ctx.cwd,
      tool: event.toolName,
      input: event.input,
    });

    if (decision.decision === "allow") return undefined;

    if (decision.decision === "confirm") {
      if (!ctx.hasUI) {
        return { block: true, reason: decision.reason };
      }
      const approved = await ctx.ui.confirm("Guardrail confirmation", decision.reason);
      if (approved) return undefined;
    }

    return {
      block: true,
      reason: [decision.reason, decision.nextAction].filter(Boolean).join("\n"),
    };
  });
}
```

Adapt `bash`, `read`, `write`, `edit`, and other tool inputs explicitly. Do not assume their
argument names match Claude-style `tool_input`.

`evaluateAndValidatePolicy` wraps the shared policy with a bounded timeout and converts
exceptions, unknown decisions, and malformed blocks into
`{ decision: "deny", reason: "Guardrail failure" }`.

Pi extensions execute with the user's system permissions. Keep the adapter small, avoid
unreviewed dependencies, and block confirmation-required operations in headless sessions.

Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
