#!/usr/bin/env node

// Claude-compatible PreToolUse adapter: reads one hook payload from stdin,
// evaluates it with the policy module given as argv[2], and translates the
// host-neutral decision. Policy `allow` stays silent so native permissions
// remain authoritative; every guard failure denies (fail closed).

import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;

// Echoing the incoming event keeps the reply valid if this guard is ever
// registered on something other than PreToolUse.
let hookEventName = "PreToolUse";

function emit(decision, reason) {
  if (decision === "deny") process.exitCode = denyExitCode();
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
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

// Codex's `exec` tool takes a JavaScript program that calls
// tools.exec_command({ cmd }), so the shell command is a literal inside source
// rather than a field the policy can read. Pull out what is statically knowable
// and report whether anything was built at runtime, which cannot be read here.
function extractEmbeddedCommands(source) {
  const commands = [];
  let dynamic = false;
  const pattern =
    /\b(?:cmd|command)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|([A-Za-z_$][\w$]*))/g;

  for (const match of source.matchAll(pattern)) {
    const [, double, single, template, identifier] = match;
    if (identifier) {
      dynamic = true;
      continue;
    }
    const raw = double ?? single ?? template;
    if (raw === undefined) continue;
    if (template !== undefined && /\$\{/u.test(template)) dynamic = true;
    try {
      commands.push(JSON.parse(`"${raw.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`));
    } catch {
      commands.push(raw);
    }
  }
  // An exec program that never names a command builds one some other way.
  if (commands.length === 0 && /exec_command|spawn|shell/u.test(source)) dynamic = true;
  return { commands, dynamic };
}

// Any tool whose name says it runs things. Guessing which field carries the
// command is what let a payload through once; for these, search the whole
// thing rather than a field name someone happened to think of.
const EXECUTION_TOOL = /^(?:bash|sh|shell|exec|exec_command|run|run_command|run_terminal|terminal|command|process)/iu;

function collectStrings(value, out = [], depth = 0) {
  if (depth > 6 || out.length > 64) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out, depth + 1);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
  }
  return out;
}

// Returns the shell commands a payload will run, however the host spells it.
function commandsFrom(input) {
  const toolInput = input?.tool_input ?? input?.input ?? input?.args ?? {};
  const direct = toolInput?.command ?? toolInput?.cmd;
  if (typeof direct === "string") return { commands: [direct], dynamic: false };

  if (!EXECUTION_TOOL.test(String(input?.tool_name ?? input?.tool ?? ""))) {
    return { commands: [], dynamic: false };
  }

  const commands = [];
  let dynamic = false;
  for (const source of collectStrings(toolInput).concat(
    typeof input?.input === "string" ? [input.input] : [],
  )) {
    const found = extractEmbeddedCommands(source);
    commands.push(...found.commands);
    dynamic ||= found.dynamic;
  }
  // A tool that exists to run things, whose command we could not read, is not
  // evidence that nothing runs.
  if (commands.length === 0) dynamic = true;
  return { commands, dynamic };
}

const RANK = { allow: 0, confirm: 1, deny: 2 };

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
  if (typeof input?.hook_event_name === "string" && input.hook_event_name) {
    hookEventName = input.hook_event_name;
  }

  let evaluatePolicy;
  try {
    ({ evaluatePolicy } = await import(pathToFileURL(path.resolve(policyArg)).href));
    if (typeof evaluatePolicy !== "function") throw new Error("missing evaluatePolicy export");
  } catch {
    emit("deny", "[guard-policy-unavailable] 无法加载策略模块。");
    return;
  }

  // A nested payload carries its commands inside source code, so evaluate each
  // one and keep the strictest verdict rather than handing the policy something
  // it will read as "not a shell call" and wave through.
  const embedded = commandsFrom(input);
  let value;
  if (embedded.commands.length > 1 || embedded.dynamic) {
    value = { decision: "allow", ruleId: "no-command-found" };
    for (const command of embedded.commands) {
      const each = await evaluatePolicy({ ...input, tool_name: "Bash", tool_input: { command } });
      if (RANK[each?.decision] > RANK[value.decision]) value = each;
    }
    if (embedded.dynamic && value.decision === "allow") {
      value = {
        decision: "confirm",
        ruleId: "unreadable-embedded-command",
        reason: "该调用在运行时拼装命令，静态检查读不到最终会执行什么。",
        nextAction: "改用字面量命令，或确认这段程序实际会执行的内容。",
      };
    }
  } else if (embedded.commands.length === 1) {
    value = await evaluatePolicy({
      ...input,
      tool_name: "Bash",
      tool_input: { ...(input?.tool_input ?? {}), command: embedded.commands[0] },
    });
  } else {
    // await tolerates a policy that returns a promise; a sync one is unaffected.
    value = await evaluatePolicy(input);
  }
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
