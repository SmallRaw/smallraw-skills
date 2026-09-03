import { spawnSync as runProcessSync } from "node:child_process";

export const CODEX_CONFIRM_TIMEOUT_SECONDS = 60;
export const CODEX_HOOK_TIMEOUT_SECONDS = CODEX_CONFIRM_TIMEOUT_SECONDS + 15;

// Keep the user-presence check outside Codex's unsupported `ask` return path.
// The dialog blocks this exact hook process; no approval token is written to
// disk, so there is nothing an Agent can manufacture or reuse later.
export const CODEX_CONFIRM_APPLESCRIPT = `
on run argv
  set promptText to item 1 of argv
  try
    set answer to display dialog promptText with title "Codex 安全确认" buttons {"拒绝", "允许一次"} default button "拒绝" cancel button "拒绝" with icon caution giving up after ${CODEX_CONFIRM_TIMEOUT_SECONDS}
    if gave up of answer then return "timeout"
    if button returned of answer is "允许一次" then return "allow"
    return "deny"
  on error errorMessage number errorNumber
    if errorNumber is -128 then return "deny"
    return "error"
  end try
end run
`;

const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

function cleanText(value, limit = 1_200) {
  const cleaned = String(value ?? "")
    .replace(BIDI_CONTROLS, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`;
}

function operationSummary(input) {
  const toolName = cleanText(input?.tool_name ?? input?.tool ?? "未知工具", 120);
  const toolInput = input?.tool_input ?? input?.input ?? input?.args;
  const command =
    typeof toolInput === "string"
      ? toolInput
      : toolInput?.command ?? toolInput?.cmd ?? null;

  if (typeof command !== "string") return { toolName, operation: "（策略原因见上方）" };
  if (toolName.toLowerCase() === "apply_patch") {
    const targets = Array.from(
      command.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gmu),
      (match) => cleanText(match[1], 300),
    );
    return {
      toolName,
      operation: targets.length > 0 ? `修改 ${targets.slice(0, 8).join("、")}` : "修改文件",
    };
  }
  return { toolName, operation: cleanText(command) || "（空命令）" };
}

function invocationIdentity(input) {
  const fields = ["session_id", "turn_id", "tool_use_id"];
  const missing = fields.filter(
    (field) => typeof input?.[field] !== "string" || input[field].trim() === "",
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Codex hook 缺少 ${missing.join("、")}，无法把确认绑定到当前这次调用。`,
    };
  }
  return { ok: true };
}

export function buildCodexConfirmation(input, value) {
  const identity = invocationIdentity(input);
  if (!identity.ok) return identity;

  const { toolName, operation } = operationSummary(input);
  const ruleId = cleanText(value?.ruleId ?? "policy", 160);
  const reason = cleanText(value?.reason ?? "该操作需要你的确认。", 1_200);
  const nextAction = cleanText(value?.nextAction, 800);
  const cwd = cleanText(input?.cwd, 600);
  const details = [
    "Codex 要执行一个需要确认的操作。",
    "只有点击“允许一次”才会放行当前这次工具调用；确认不会保存或复用。",
    "",
    `策略：${ruleId}`,
    `原因：${reason}`,
    nextAction ? `建议：${nextAction}` : null,
    `工具：${toolName}`,
    `操作：${operation}`,
    cwd ? `目录：${cwd}` : null,
  ].filter((line) => line !== null);
  return { ok: true, text: details.join("\n") };
}

export function requestCodexConfirmation(input, value, dependencies = {}) {
  const prepared = buildCodexConfirmation(input, value);
  if (!prepared.ok) return { approved: false, status: "unavailable", reason: prepared.reason };

  const platform = dependencies.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      approved: false,
      status: "unavailable",
      reason: "当前系统没有可用的 Codex 本机确认弹窗。",
    };
  }

  const spawnSync = dependencies.spawnSync ?? runProcessSync;
  let result;
  try {
    result = spawnSync(
      "/usr/bin/osascript",
      ["-e", CODEX_CONFIRM_APPLESCRIPT, prepared.text],
      {
        encoding: "utf8",
        timeout: (CODEX_CONFIRM_TIMEOUT_SECONDS + 5) * 1_000,
        windowsHide: true,
      },
    );
  } catch {
    return { approved: false, status: "error", reason: "启动 Codex 本机确认弹窗失败。" };
  }

  if (result?.error?.code === "ETIMEDOUT") {
    return { approved: false, status: "timed-out", reason: "Codex 本机确认弹窗已超时。" };
  }
  const answer = String(result?.stdout ?? "").trim();
  if (result?.status === 0 && answer === "allow") {
    return { approved: true, status: "approved" };
  }
  if (answer === "timeout") {
    return { approved: false, status: "timed-out", reason: "Codex 本机确认弹窗已超时。" };
  }
  if (answer === "deny") {
    return { approved: false, status: "declined", reason: "用户没有批准当前这次操作。" };
  }
  return { approved: false, status: "error", reason: "Codex 本机确认弹窗没有返回有效结果。" };
}
