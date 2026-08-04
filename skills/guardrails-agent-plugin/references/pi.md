# Pi Adapter

Pi uses an in-process TypeScript extension, not a command hook, so `scripts/guard.mjs` does
not apply. Checked against Pi's extension docs and examples on 2026-08-04.

`tool_call` fires before a tool runs; returning `{ block: true }` skips it.
`ctx.ui.confirm(title, message)` resolves to a boolean.

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
    if (decision.decision === "confirm" && (await confirmOrFalse(ctx, decision))) {
      return undefined;
    }
    return {
      block: true,
      reason: [decision.reason, decision.nextAction].filter(Boolean).join("\n"),
    };
  });
}
```

`confirmOrFalse` bounds `ctx.ui.confirm` with a timeout and returns `false` on timeout or
rejection — UI calls become JSON messages in RPC mode, so a prompt may never be answered,
and an unanswered prompt is not approval. `evaluateAndValidatePolicy` turns exceptions,
unknown decisions, and malformed blocks into a deny.

Adapt `bash`, `read`, `write`, and `edit` inputs explicitly; their argument names are not
Claude-style `tool_input`.

Not found in the docs — verify before relying on any of it: extension file paths (an
earlier revision guessed `~/.pi/agent/extensions/`), a `ctx.hasUI` flag (the pattern above
avoids needing one), and whether a thrown handler blocks (return `{ block: true }` instead).

Extensions run with the user's permissions: keep the adapter small and dependency-free.

Sources: [extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) ·
[examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions)
