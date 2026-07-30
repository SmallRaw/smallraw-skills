#!/usr/bin/env node

// Claude-compatible PreToolUse adapter: reads one hook payload from stdin,
// evaluates it with the policy module given as argv[2], and translates the
// host-neutral decision. Policy `allow` stays silent so native permissions
// remain authoritative; every guard failure denies (fail closed).

import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;

function emit(decision, reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

function reasonText(value) {
  const parts = [
    value.reason ?? "The operation is not permitted by policy.",
    value.nextAction,
  ].filter(Boolean);
  return `[${value.ruleId ?? "policy"}] ${parts.join(" ")}`;
}

async function main() {
  const policyArg = process.argv[2];
  if (!policyArg) {
    emit("deny", "[guard-misconfigured] No policy module path was provided to the guard hook.");
    return;
  }

  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) {
      emit("deny", "[guard-input-too-large] The hook payload exceeds the guard size limit.");
      return;
    }
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    emit("deny", "[guard-invalid-json] The hook payload is not valid JSON.");
    return;
  }

  let evaluatePolicy;
  try {
    ({ evaluatePolicy } = await import(pathToFileURL(path.resolve(policyArg)).href));
    if (typeof evaluatePolicy !== "function") throw new Error("missing evaluatePolicy export");
  } catch {
    emit("deny", "[guard-policy-unavailable] The policy module could not be loaded.");
    return;
  }

  const value = evaluatePolicy(input);
  if (
    !value ||
    typeof value !== "object" ||
    !["allow", "confirm", "deny"].includes(value.decision)
  ) {
    emit("deny", "[guard-invalid-decision] The policy returned an unrecognized decision.");
    return;
  }
  if (value.decision === "deny") {
    emit("deny", reasonText(value));
  } else if (value.decision === "confirm") {
    emit("ask", reasonText(value));
  }
}

main().catch(() => {
  emit("deny", "[guard-evaluation-error] The guard failed while evaluating the operation.");
});
