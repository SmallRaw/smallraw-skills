#!/usr/bin/env node

// Claude-compatible PreToolUse adapter: reads one hook payload from stdin,
// evaluates it with the policy module given as argv[2], and translates the
// host-neutral decision. Policy `allow` stays silent so native permissions
// remain authoritative; every guard failure denies (fail closed).

import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;

function emit(decision, reason) {
  if (decision === "deny") process.exitCode = denyExitCode();
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
  const parts = [value.reason ?? "该操作不被策略允许。", value.nextAction].filter(Boolean);
  return `[${value.ruleId ?? "policy"}] ${parts.join(" ")}`;
}

// Hosts that fail open on a non-zero exit still honour an explicit blocking
// code. The installer sets this per host so a deny is signalled twice.
function denyExitCode() {
  const index = process.argv.indexOf("--deny-exit");
  if (index < 0) return 0;
  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

async function main() {
  const policyArg = process.argv[2];

  // Always drain stdin before deciding anything. Exiting while the host is still
  // writing the payload can break its pipe, which surfaces as a hook error
  // rather than as this guard's verdict.
  let raw = "";
  let oversized = false;
  for await (const chunk of process.stdin) {
    if (oversized) continue;
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) oversized = true;
  }

  if (!policyArg) {
    emit("deny", "[guard-misconfigured] 未向 guard hook 传入策略模块路径。");
    return;
  }
  if (oversized) {
    emit("deny", "[guard-input-too-large] hook 载荷超过 guard 的大小限制。");
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    emit("deny", "[guard-invalid-json] hook 载荷不是合法 JSON。");
    return;
  }

  let evaluatePolicy;
  try {
    ({ evaluatePolicy } = await import(pathToFileURL(path.resolve(policyArg)).href));
    if (typeof evaluatePolicy !== "function") throw new Error("missing evaluatePolicy export");
  } catch {
    emit("deny", "[guard-policy-unavailable] 无法加载策略模块。");
    return;
  }

  const value = evaluatePolicy(input);
  if (
    !value ||
    typeof value !== "object" ||
    !["allow", "confirm", "deny"].includes(value.decision)
  ) {
    emit("deny", "[guard-invalid-decision] 策略返回了无法识别的决策。");
    return;
  }
  if (value.decision === "deny") {
    emit("deny", reasonText(value));
  } else if (value.decision === "confirm") {
    emit("ask", reasonText(value));
  }
}

main().catch(() => {
  emit("deny", "[guard-evaluation-error] guard 在判定该操作时失败。");
});
