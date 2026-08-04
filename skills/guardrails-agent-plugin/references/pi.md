# Pi Adapter

Pi uses an in-process TypeScript extension rather than a command-based `PreToolUse` hook,
so `scripts/guard.mjs` does not apply. Keep the policy host-neutral and make the extension
a thin translator.

Verified against the Pi extension docs and the bundled extension examples on 2026-08-04.
Anything marked unverified below was not found in the documentation — confirm it against
the installed version before relying on it, and say so in the install report.

## Tool Adapter

`tool_call` fires before a tool runs, and returning `{ block: true }` skips execution.
`ctx.ui.confirm(title, message)` is real and resolves to a boolean.

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
      // UI methods map to TUI components interactively and to JSON messages in
      // RPC mode, so a prompt may never be answered. Anything other than an
      // explicit yes blocks.
      const approved = await confirmOrFalse(ctx, decision);
      if (approved) return undefined;
    }

    return {
      block: true,
      reason: [decision.reason, decision.nextAction].filter(Boolean).join("\n"),
    };
  });
}
```

`confirmOrFalse` wraps `ctx.ui.confirm` with a bounded timeout and returns `false` on
timeout, rejection, or a missing UI — never treat an unanswered prompt as approval.

`evaluateAndValidatePolicy` wraps the shared policy with its own timeout and converts
exceptions, unknown decisions, and malformed blocks into
`{ decision: "deny", reason: "Guardrail failure" }`.

Adapt `bash`, `read`, `write`, `edit`, and other tool inputs explicitly. Do not assume their
argument names match Claude-style `tool_input`.

## Unverified

- **Extension file locations.** Earlier revisions of this file named
  `~/.pi/agent/extensions/*.ts` and `.pi/extensions/*.ts`; neither appears in the
  documentation consulted. Read Pi's current docs or `pi --help` before writing anything to
  disk, and never guess a path.
- **A `ctx.hasUI` flag.** An earlier revision branched on it. It is not documented and may
  not exist — the pattern above avoids needing it.
- **Handler exception behaviour.** Whether a thrown error blocks or is swallowed is not
  documented. Do not rely on throwing; return an explicit `{ block: true }`.

Pi extensions execute with the user's system permissions. Keep the adapter small, avoid
unreviewed dependencies, and block confirmation-required operations that cannot be answered.

Sources:
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions
- https://deepwiki.com/earendil-works/pi/6.1-extension-api-and-lifecycle-events
