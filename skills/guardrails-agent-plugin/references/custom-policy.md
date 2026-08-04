# Installing a Policy the Bundled Installer Does Not Cover

Read this only when `install-or-update.mjs` refuses — an unlisted host, or a policy that is
not one of the bundled guidelines modules. For everything else the installer is the route,
and packaging a new plugin is the wrong move when a user-level registration already exists.

1. Preserve the caller's exact allow, confirm, deny, preflight, and remediation semantics.
   Clarify only when a missing choice would materially change enforcement.
2. Check the host's real registration point and any existing entry for this policy's stable
   ID first. Update that entry; never append a duplicate or create a plugin to work around it.
3. Choose the narrowest deterministic lifecycle event and matcher. Prefer a command or
   native callback over an LLM-backed prompt or agent hook.
4. Reuse `scripts/guard.mjs` on any host that accepts Claude-compatible payloads — Codex and
   Cursor both do. A second adapter duplicates the decision translation, which is where a
   wrong capability claim gets baked in and outlives the document it came from. If one is
   unavoidable, record the source document and date in it, and give it the same
   `statusMessage` marker so the installer can find it.
5. Reuse a caller-provided policy module. If the caller supplies only rules, materialize
   them once as a host-neutral policy module; keep every host adapter limited to input
   normalization, policy invocation, and decision translation.
6. Strictly validate policy output. Errors, timeouts, unknown decisions, and malformed
   blocks must use the host's explicit blocking path where possible; report unavoidable
   fail-open behavior.
7. Use native confirmation when available. Otherwise treat `confirm` as `deny` and report
   the semantic gap unless the caller explicitly requests a session-scoped, single-use
   approval bound to the normalized operation. Never weaken `confirm` or `deny` to `allow`.
8. Verify once with harmless allow and block cases, then report the files, scope, active
   events, trust state, and residual coverage gaps.

## Before Adding a Host to the Installer

Encode a host only after confirming all three, from that host's own documentation:

- the exact registration path and event name;
- that the event can actually block, not merely observe;
- the exact deny output shape, and what happens on hook error or timeout.

Without the second and third, a registration reads as protection while silently no-opping —
worse than no hook at all. Telemetry hooks work almost everywhere; blocking hooks do not.
