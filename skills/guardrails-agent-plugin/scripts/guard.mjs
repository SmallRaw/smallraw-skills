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

// A refusal works in two steps, and both have to arrive here. The policy
// supplies the first — what happened, and the spelling that does the same job
// without an approval. The second is what to do when there is no such spelling,
// and it cannot live in the guideline file: those load in well under one
// percent of sessions, while this line arrives every single time.
const WHEN_NO_SAFE_FORM =
  "换不成安全写法就停在这里：记下这一步和它要做的事，把不需要审批的先做完，收尾时一并提出来。不要改写命令重试。";

function reasonText(value, decision) {
  const parts = [value.reason ?? "该操作不被策略允许。", value.nextAction].filter(Boolean);
  if (decision === "deny") parts.push(WHEN_NO_SAFE_FORM);
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

// Keep data strings out of the structural scan below. An apply_patch program
// can carry TypeScript such as a template-literal command property as plain
// text; reading that text as part of the surrounding JavaScript invents a
// shell command that will never run.
function structuralSource(source) {
  const output = Array.from(source, () => " ");
  const backtick = String.fromCharCode(96);
  const stack = [{ kind: "code", braceDepth: null }];

  for (let index = 0; index < source.length; index += 1) {
    const state = stack.at(-1);
    const character = source[index];
    const next = source[index + 1];

    if (state.kind === "line-comment") {
      if (character === "\n") {
        stack.pop();
        output[index] = character;
      }
      continue;
    }
    if (state.kind === "block-comment") {
      if (character === "*" && next === "/") {
        stack.pop();
        index += 1;
      }
      continue;
    }
    if (state.kind === "string") {
      if (character === "\\") index += 1;
      else if (character === state.quote) stack.pop();
      continue;
    }
    if (state.kind === "template") {
      if (character === "\\") {
        index += 1;
      } else if (character === backtick) {
        stack.pop();
      } else if (character === "$" && next === "{") {
        stack.push({ kind: "code", braceDepth: 0 });
        index += 1;
      }
      continue;
    }

    if (state.braceDepth === 0 && character === "}") {
      stack.pop();
      continue;
    }
    if (character === "/" && next === "/") {
      stack.push({ kind: "line-comment" });
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      stack.push({ kind: "block-comment" });
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      stack.push({ kind: "string", quote: character });
      continue;
    }
    if (character === backtick) {
      stack.push({ kind: "template" });
      continue;
    }

    output[index] = character;
    if (state.braceDepth !== null) {
      if (character === "{") state.braceDepth += 1;
      else if (character === "}") state.braceDepth -= 1;
    }
  }

  return output.join("");
}

// Codex's `exec` tool takes a JavaScript program that calls
// tools.exec_command({ cmd }), so the shell command is a literal inside source
// rather than a field the policy can read. Pull out what is statically knowable
// and report whether anything was built at runtime, which cannot be read here.
function extractEmbeddedCommands(source) {
  const commands = [];
  let dynamic = false;
  const structure = structuralSource(source);
  const pattern =
    /\b(?:cmd|command)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|([A-Za-z_$][\w$]*))/g;

  for (const match of source.matchAll(pattern)) {
    if (structure[match.index] !== source[match.index]) continue;
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
  const toolCalls = Array.from(
    structure.matchAll(/\btools\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/gu),
    (match) => match[1],
  );
  const executionCalls = toolCalls.filter((name) => EXECUTION_TOOL.test(name)).length;
  const bashCalls = toolCalls.filter((name) => BASH_TOOL.test(name)).length;
  if (executionCalls > commands.length) dynamic = true;
  if (
    commands.length === 0 &&
    (/\b(?:exec_command|spawn|shell)\b/u.test(structure) || /\btools\s*\[/u.test(structure))
  ) {
    dynamic = true;
  }
  return { commands, dynamic, toolCalls: toolCalls.length, bashCalls };
}

// Any tool whose name says it runs things. Guessing which field carries the
// command is what let a payload through once; for these, search the whole
// thing rather than a field name someone happened to think of.
const EXECUTION_TOOL = /^(?:bash|sh|shell|exec|exec_command|run|run_command|run_terminal|terminal|command|process)/iu;
const BASH_TOOL = /^(?:bash|exec_command)$/iu;

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
  const toolName = String(input?.tool_name ?? input?.tool ?? "");

  if (!EXECUTION_TOOL.test(toolName)) {
    return { commands: [], dynamic: false, bash: false };
  }

  const direct = toolInput?.command ?? toolInput?.cmd;
  if (typeof direct === "string") {
    return { commands: [direct], dynamic: false, bash: BASH_TOOL.test(toolName) };
  }

  const commands = [];
  let dynamic = false;
  let bash = BASH_TOOL.test(toolName);
  let nestedToolCalls = 0;
  for (const source of collectStrings(toolInput).concat(
    typeof input?.input === "string" ? [input.input] : [],
  )) {
    const found = extractEmbeddedCommands(source);
    commands.push(...found.commands);
    dynamic ||= found.dynamic;
    bash ||= found.bashCalls > 0;
    nestedToolCalls += found.toolCalls;
  }
  // A tool that exists to run things, whose command we could not read, is not
  // evidence that nothing runs. A program made only of explicit non-execution
  // tool calls is different: its string arguments are data for those tools.
  if (commands.length === 0 && nestedToolCalls === 0) dynamic = true;
  return { commands, dynamic, bash };
}

const RANK = { allow: 0, confirm: 1, deny: 2 };

// A wrapper carries another command inside it. Every policy reads only the text
// it is handed, so without opening one, a push, a publish, a deletion and a
// secret read can ride through `bash -c '…'` or `$( … )` with every gate seeing
// nothing but a quoted string. Opening it is a choice, not a capability: the
// payload is a literal sitting right there.
const MAX_WRAPPER_DEPTH = 3;
const SHELL_DASH_C = /\b(?:ba|da|k|z)?sh\s+(?:-[A-Za-z]+\s+)*-c\s+(?:'([^']*)'|"([^"]*)"|(\S+))/gu;
const LITERAL_ASSIGNMENT = /(?:^|[\s;&|])([A-Za-z_][A-Za-z0-9_]*)=("([^"$`]*)"|'([^']*)'|([^\s;&|'"$`]+))/gu;

// Bodies of $( ) and ` `, found without treating a quote inside one as if it
// belonged to the text around it. A substitution runs even inside double
// quotes, so only a single-quoted region hides one.
function substitutionBodies(command) {
  const bodies = [];
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === "\\" && quote !== "'") {
      index += 1;
      continue;
    }
    const opens =
      quote !== "'" &&
      (character === "`" || (character === "$" && command[index + 1] === "("));
    if (opens) {
      const end = closingIndex(command, index);
      if (end !== -1) {
        bodies.push(
          character === "`"
            ? command.slice(index + 1, end - 1)
            : command.slice(index + 2, end - 1),
        );
        index = end - 1;
        continue;
      }
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
  }
  return bodies;
}

function closingIndex(source, start) {
  if (source[start] === "`") {
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "\\") index += 1;
      else if (source[index] === "`") return index + 1;
    }
    return -1;
  }
  let depth = 0;
  let quote = "";
  for (let index = start + 2; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\" && quote !== "'") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") index += 1;
    else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0) return index + 1;
      depth -= 1;
    }
  }
  return -1;
}

// A path parked in a variable earlier in the same command is still literal, so
// resolve those before deciding a payload cannot be read. `A=/path/to/adb;
// echo $($A shell …)` is readable; `bash -c "$CMD"` is not.
function withLiteralsResolved(payload, outer) {
  const values = new Map();
  LITERAL_ASSIGNMENT.lastIndex = 0;
  for (const match of outer.matchAll(LITERAL_ASSIGNMENT)) {
    values.set(match[1], match[3] ?? match[4] ?? match[5] ?? "");
  }
  return payload.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu,
    (whole, braced, bare) => values.get(braced ?? bare) ?? whole,
  );
}

// Unreadable means the command word itself only exists after expansion, not
// that an argument somewhere holds a variable.
function namesNoCommand(payload) {
  return /^\s*(?:\$|`)/u.test(payload) || payload.trim() === "";
}

function wrappedCommands(command, depth = 0) {
  const payloads = [];
  let unreadable = false;
  if (depth >= MAX_WRAPPER_DEPTH) return { payloads, unreadable };

  const found = [];
  SHELL_DASH_C.lastIndex = 0;
  for (const match of command.matchAll(SHELL_DASH_C)) {
    const literal = match[1] ?? match[2];
    if (literal === undefined) unreadable = true;
    else found.push(literal);
  }
  found.push(...substitutionBodies(command));

  for (const body of found) {
    const resolved = withLiteralsResolved(body, command);
    if (namesNoCommand(resolved)) {
      unreadable = true;
      continue;
    }
    payloads.push(resolved);
    const deeper = wrappedCommands(resolved, depth + 1);
    payloads.push(...deeper.payloads);
    unreadable ||= deeper.unreadable;
  }
  return { payloads, unreadable };
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

  // Then read whatever those commands were carrying. This is what keeps a gate
  // from going blind on `bash -c 'git push && rm -rf x'`: the payload is judged
  // by the same policy, as the command it is.
  let unreadableWrapper = false;
  if (embedded.bash) {
    for (const command of embedded.commands) {
      const carried = wrappedCommands(command);
      unreadableWrapper ||= carried.unreadable;
      for (const payload of carried.payloads) {
        const each = await evaluatePolicy({
          ...input,
          tool_name: "Bash",
          tool_input: { ...(input?.tool_input ?? {}), command: payload },
        });
        if (RANK[each?.decision] > RANK[value?.decision ?? "allow"]) value = each;
      }
    }
  }
  // A payload that only exists once the shell expands it cannot be judged at
  // all, and letting it past would blind every gate at once rather than one.
  if (unreadableWrapper && RANK[value?.decision ?? "allow"] < RANK.deny) {
    value = {
      decision: "deny",
      ruleId: "unreadable-wrapper",
      reason: "这条命令要执行的内容藏在变量里，展开之前读不出来。",
      nextAction: "把命令平铺写出来。",
    };
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
    emit("deny", reasonText(value, "deny"));
  } else if (value.decision === "confirm") {
    emit("ask", reasonText(value, "confirm"));
  }
}

main().catch(() => {
  emit("deny", "[guard-evaluation-error] guard 在判定该操作时失败。");
});
