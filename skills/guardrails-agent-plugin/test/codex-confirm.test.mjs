import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_CONFIRM_APPLESCRIPT,
  CODEX_CONFIRM_TIMEOUT_SECONDS,
  buildCodexConfirmation,
  requestCodexConfirmation,
} from "../scripts/codex-confirm.mjs";

const input = {
  session_id: "session-123",
  turn_id: "turn-456",
  tool_use_id: "tool-789",
  cwd: "/workspace/project",
  tool_name: "Bash",
  tool_input: { command: "git push --force-with-lease origin main" },
};
const decision = {
  decision: "confirm",
  ruleId: "force-push",
  reason: "会改写远端分支。",
  nextAction: "确认目标分支。",
};

test("builds a bounded, exact-operation confirmation message", () => {
  const prepared = buildCodexConfirmation(input, decision);
  assert.equal(prepared.ok, true);
  assert.match(prepared.text, /force-push/u);
  assert.match(prepared.text, /git push --force-with-lease origin main/u);
  assert.match(prepared.text, /只.*允许一次/u);
  assert.match(prepared.text, /\/workspace\/project/u);

  const spoofed = buildCodexConfirmation(
    { ...input, tool_input: { command: `git push \u202emain\u0000` } },
    decision,
  );
  assert.doesNotMatch(spoofed.text, /[\u0000\u202e]/u);
});

test("requires Codex invocation identity before offering approval", () => {
  let called = false;
  const result = requestCodexConfirmation(
    { ...input, tool_use_id: undefined },
    decision,
    {
      platform: "darwin",
      spawnSync: () => {
        called = true;
        return { status: 0, stdout: "allow\n" };
      },
    },
  );
  assert.equal(result.approved, false);
  assert.equal(result.status, "unavailable");
  assert.equal(called, false);
});

test("allows only the live invocation approved by the macOS dialog", () => {
  let invocation;
  const result = requestCodexConfirmation(input, decision, {
    platform: "darwin",
    spawnSync: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: "allow\n" };
    },
  });
  assert.deepEqual(result, { approved: true, status: "approved" });
  assert.equal(invocation.command, "/usr/bin/osascript");
  assert.equal(invocation.args[0], "-e");
  assert.equal(invocation.args[1], CODEX_CONFIRM_APPLESCRIPT);
  assert.match(invocation.args[2], /当前这次工具调用/u);
  assert.equal(invocation.options.timeout, (CODEX_CONFIRM_TIMEOUT_SECONDS + 5) * 1_000);
});

test("decline, timeout, invalid output, and unsupported platforms fail closed", () => {
  const run = (stdout, status = 0) =>
    requestCodexConfirmation(input, decision, {
      platform: "darwin",
      spawnSync: () => ({ status, stdout }),
    });

  assert.equal(run("deny\n").status, "declined");
  assert.equal(run("timeout\n").status, "timed-out");
  assert.equal(run("surprise\n").status, "error");
  assert.equal(
    requestCodexConfirmation(input, decision, { platform: "linux" }).status,
    "unavailable",
  );
});
