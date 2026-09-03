import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function createRun(overrides = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "technical-story-run-"));
  const files = {
    "00-task.md": [
      "模式：完整故事",
      "## 任务",
      "给小白解释 Agent 和三种代码 Agent 形态。",
      "## 正文要悟到",
      "- Agent 和普通聊天在完成任务这件事上有什么不同？\n- Agent 为什么需要根据反馈继续改变下一步？",
      "## 账本要说清",
      "- 图形客户端和命令行入口有什么区别？\n- 两种同类代码 Agent 为什么仍不是同一个产品？",
      "## 必讲项",
      "- Agent\n- Codex 客户端\n- Codex CLI\n- Claude Code",
    ].join("\n\n"),
    "01-facts.md": [
      "## 事实边界",
      "产品事实已经核查。",
      "## 底层机制",
      "Agent 围绕目标调用工具、观察反馈并继续修正。",
      "## 概念坐标",
      "能力机制、交互入口和产品生态彼此分开。",
      "## 材料边界",
      "不做强弱排名。",
    ].join("\n\n"),
    "02-story-plan.md": [
      "## 解释目标",
      "逐题写清小白需要理解的答案。",
      "## 故事方案",
      "一个人在现实反馈中从只给建议转向持续把目标做完。",
      "## 正文映射",
      "- 核心机制：持续行动 | 误判：回答等于完成 | 后果：现实未改变 | 反馈：失败可见 | 修正：继续行动并验证",
      "## 适配检查",
      "- 产品化身：无\n- 原生因果：人物即使不承担技术解释，也必须解决现实失败。",
      "## 正文禁词",
      "- Agent\n- Codex\n- Codex CLI\n- Claude Code",
      "## 结尾账本",
      "正文事件解释共同机制，产品入口与生态差异在结尾直接说明。",
    ].join("\n\n"),
    "03-drafts.md": [
      "# draft-1",
      "## 故事正文",
      "他以为说出办法就算完成，直到原物仍停在原处。后来他根据每次回来的结果继续处理，直到对方亲手验收。",
      "## 真实技术账本",
      "Agent 不只回答，还会调用工具并根据反馈继续行动。Codex 客户端偏可视化任务管理；Codex CLI 从命令行进入本地开发循环；Claude Code 是 Anthropic 生态中的同类代码 Agent。入口和生态不同不等于简单强弱。",
    ].join("\n\n"),
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：通过\n综合评分：92\n审稿结论：通过",
    ].join("\n\n"),
    "05-final.md": [
      "## 产物审计",
      "upstream validator：通过\nfinal validator：通过",
      "## 完整故事定版",
      "### 故事正文\n他根据反馈继续处理，直到目标完成。\n\n### 真实技术账本\nAgent 会持续行动；不同产品入口和生态不同。",
    ].join("\n\n"),
    ...overrides,
  };

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(runDir, name), content);
  }
  return runDir;
}

function validate(runDir, phase = "final") {
  return spawnSync(
    process.execPath,
    [new URL("../scripts/validate_run.mjs", import.meta.url).pathname, runDir, "--phase", phase],
    { encoding: "utf8" },
  );
}

test("skill uses four stages instead of the old multi-agent bureaucracy", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /## 四步流程/);
  assert.match(skill, /查明事实/);
  assert.match(skill, /设计一个解释故事/);
  assert.match(skill, /知情写作/);
  assert.match(skill, /双闸门审稿/);
  assert.doesNotMatch(skill, /三个.*scout/i);
  assert.doesNotMatch(skill, /独立命题裁判/);
  assert.doesNotMatch(skill, /隐藏审计/);
  assert.doesNotMatch(skill, /架构审稿/);
});

test("writer knows the task and facts while keeping terms out of the body", () => {
  const skill = read("SKILL.md");
  const writer = read("references/roles/story-writer.md");
  assert.match(skill, /story-writer\.md.*任务、事实、故事计划/s);
  assert.match(skill, /禁止再用“让作者失忆”/);
  assert.match(writer, /You know what the story must explain/i);
  assert.match(writer, /## 故事正文.*## 真实技术账本/s);
  assert.match(writer, /正文禁词/);
});

test("only six focused portable roles remain", () => {
  const active = [
    "story-researcher",
    "story-designer",
    "story-writer",
    "novice-reviewer",
    "comprehensive-reviewer",
    "story-rewriter",
  ];
  for (const role of active) {
    assert.equal(existsSync(new URL(`references/roles/${role}.md`, root)), true);
    assert.match(read(`references/roles/${role}.md`), /## Contract/);
  }
  for (const removed of ["premise-scout", "premise-judge", "story-architect", "technical-reviewer", "literary-reviewer", "continuity-reviewer"]) {
    assert.equal(existsSync(new URL(`references/roles/${removed}.md`, root)), false);
  }
});

test("reviewers prioritize novice comprehension and respect ledger carriers", () => {
  const novice = read("references/roles/novice-reviewer.md");
  const comprehensive = read("references/roles/comprehensive-reviewer.md");
  assert.match(novice, /every question under `## 正文要悟到`/i);
  assert.match(novice, /Do not use outside knowledge/i);
  assert.match(novice, /ignore `## 真实技术账本` completely/i);
  assert.match(comprehensive, /at least 90/i);
  assert.match(comprehensive, /hard-suit check/i);
  assert.match(comprehensive, /fix A, discover B/i);
  assert.match(comprehensive, /caps the score at 89/i);
  assert.match(comprehensive, /显式解码条目/);
  assert.match(comprehensive, /独立新故障/);
  assert.match(comprehensive, /可删除说教段/);
  assert.match(comprehensive, /Do not waive a counted failure/i);
  assert.match(novice, /do not fail them merely because they have no fictional event/i);
  assert.match(comprehensive, /Never require a question under `## 账本要说清` to receive a fictional event/i);
  assert.match(comprehensive, /Only `## 正文要悟到` needs dramatic evidence/i);
  assert.match(comprehensive, /product-comparison exposition to character dialogue as a defect/i);
  assert.match(comprehensive, /after-the-fact note is claimed to implement a system guarantee/i);
  assert.match(read("references/roles/story-rewriter.md"), /request conflicts with the carrier contract/i);
  assert.match(read("references/roles/story-writer.md"), /Do not force every ledger-carried subterm/i);
  assert.match(comprehensive, /Do not read the story plan/i);
  assert.match(read("SKILL.md"), /禁止向它提供故事计划或适配自检/);
});

test("story roles reject cascading-status workflow fiction", () => {
  const designer = read("references/roles/story-designer.md");
  const writer = read("references/roles/story-writer.md");
  assert.match(designer, /one existing relationship/i);
  assert.match(designer, /at most two feedback turns/i);
  assert.match(designer, /delete it if the plot still works without it/i);
  assert.match(designer, /same real task/i);
  assert.match(writer, /Merge or cut supporting characters who only deliver status/i);
  assert.match(writer, /Run a deletion test on each/i);
  assert.match(writer, /same real task/i);
  assert.match(read("references/roles/comprehensive-reviewer.md"), /include the inciting mismatch/i);
  assert.match(read("references/roles/comprehensive-reviewer.md"), /semantic continuity/i);
  assert.match(read("references/style-examples.md"), /不靠不断增加新故障和新部门/);
});

test("upstream accepts a compact factual plan", () => {
  const runDir = createRun();
  try {
    const result = validate(runDir, "upstream");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VALID upstream/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("upstream accepts semantically equivalent bold field labels", () => {
  const runDir = createRun({
    "02-story-plan.md": [
      "## 解释目标\n解释目标。",
      "## 故事方案\n一个自然故事。",
      "## 正文映射\n- **核心机制**：持续行动",
      "## 适配检查\n- **产品化身：** 无",
      "## 正文禁词\n- Agent",
      "## 结尾账本\n直接比较产品。",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir, "upstream");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("upstream accepts a bold core mechanism heading without a list marker", () => {
  const runDir = createRun({
    "02-story-plan.md": [
      "## 解释目标\n目标",
      "## 故事方案\n方案",
      "## 正文映射\n**核心机制：持续行动**",
      "## 适配检查\n- 产品化身：无",
      "## 正文禁词\nAgent",
      "## 结尾账本\n账本",
    ].join("\n"),
  });
  try {
    const result = validate(runDir, "upstream");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator accepts a complete four-stage delivery", () => {
  const runDir = createRun();
  try {
    const result = validate(runDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VALID final/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects more than two body mechanisms", () => {
  const runDir = createRun({
    "02-story-plan.md": [
      "## 解释目标\n三个目标。",
      "## 故事方案\n一个故事。",
      "## 正文映射\n- 核心机制：一\n- 核心机制：二\n- 核心机制：三",
      "## 适配检查\n- 产品化身：无",
      "## 正文禁词\n- Agent",
      "## 结尾账本\n产品差异。",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir, "upstream");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /1 到 2 个核心机制/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("upstream requires an explicit no-product-avatar check", () => {
  const runDir = createRun({
    "02-story-plan.md": [
      "## 解释目标\n解释目标。",
      "## 故事方案\n一个自然故事。",
      "## 正文映射\n- 核心机制：持续行动",
      "## 适配检查\n- 产品化身：三个房间分别代表三个产品",
      "## 正文禁词\n- Agent",
      "## 结尾账本\n直接比较产品。",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir, "upstream");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /产品化身：无/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects technical terms leaked into the story body", () => {
  const runDir = createRun({
    "03-drafts.md": [
      "# draft-1",
      "## 故事正文",
      "他叫来了 Agent 替自己工作。",
      "## 真实技术账本",
      "Agent 会持续行动。",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /故事正文泄漏禁词 Agent/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects an incomplete body comprehension test", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：通过\n正文理解：1/2\n账本理解：2/2\n审稿结论：退回",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：通过\n综合评分：92\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /正文理解没有全部通过/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects a novice pass copied only from the ledger", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：退回\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：通过\n综合评分：92\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /正文机制测试没有通过/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects a sub-90 comprehensive review", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：通过\n综合评分：89\n审稿结论：退回",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /综合评分必须达到 90/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects a high score when the hard-suit gate fails", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：退回\n综合评分：95\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /硬套检查没有通过/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator requires two independent reviewers", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿",
      "审稿方式：独立子 Agent\nAgent ID：same\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿",
      "审稿方式：独立子 Agent\nAgent ID：same\n硬套检查：通过\n综合评分：92\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /不同 Agent/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator accepts one rewrite with fresh reviewers", () => {
  const originalDraft = createRun();
  const draftOne = readFileSync(join(originalDraft, "03-drafts.md"), "utf8");
  rmSync(originalDraft, { recursive: true, force: true });
  const runDir = createRun({
    "03-drafts.md": [
      draftOne,
      "# repair-ticket\n修复解释连接。",
      "# draft-2\n## 故事正文\n他根据每次反馈继续处理，直到目标完成。\n\n## 真实技术账本\nAgent 会持续行动。Codex 客户端、Codex CLI 和 Claude Code 共享代码 Agent 基线，但入口与生态不同。",
    ].join("\n\n"),
    "04-reviews.md": [
      "## draft-1 小白审稿\n审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：退回\n正文理解：1/2\n账本理解：2/2\n审稿结论：退回",
      "## draft-1 综合审稿\n审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：退回\n综合评分：88\n审稿结论：退回",
      "## draft-2 小白审稿\n审稿方式：独立子 Agent\nAgent ID：novice-2\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-2 综合审稿\n审稿方式：独立子 Agent\nAgent ID：comprehensive-2\n硬套检查：通过\n综合评分：93\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator keeps nested reviewer headings inside the same review", () => {
  const originalDraft = createRun();
  const draftOne = readFileSync(join(originalDraft, "03-drafts.md"), "utf8");
  rmSync(originalDraft, { recursive: true, force: true });
  const runDir = createRun({
    "03-drafts.md": [
      draftOne,
      "# repair-ticket\n修复解释连接。",
      "# draft-2\n## 故事正文\n他根据反馈继续处理，直到目标完成。\n\n## 真实技术账本\nAgent 会持续行动；产品入口与生态不同。",
    ].join("\n\n"),
    "04-reviews.md": [
      "## draft-1 小白审稿\n## 审稿方式：独立子 Agent\n\n**Agent ID:** novice-1\n\n### 正文机制测试：退回\n正文理解：1/2\n账本理解：2/2\n### 审稿结论：退回",
      "## draft-1 综合审稿\n审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n硬套检查：退回\n综合评分：88\n审稿结论：退回",
      "## draft-2 小白审稿\n审稿方式：独立子 Agent\nAgent ID：novice-2\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过\n\n## 正文机制测试\n逐题证据。",
      "## draft-2 综合审稿\n审稿方式：独立子 Agent\nAgent ID：comprehensive-2\n硬套检查：通过\n综合评分：93\n审稿结论：通过",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator ignores a repeated current review heading from the worker", () => {
  const runDir = createRun({
    "04-reviews.md": [
      "## draft-1 小白审稿\n审稿方式：独立子 Agent\nAgent ID：novice-1\n正文机制测试：通过\n正文理解：2/2\n账本理解：2/2\n审稿结论：通过",
      "## draft-1 综合审稿\n审稿方式：独立子 Agent\nAgent ID：comprehensive-1\n\n## draft-1 综合审稿\n**硬套检查：通过**\n**综合评分：92**\n**审稿结论：通过**",
    ].join("\n\n"),
  });
  try {
    const result = validate(runDir);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("validator rejects a third draft", () => {
  const runDir = createRun({
    "03-drafts.md": "# draft-1\n## 故事正文\n正文。\n## 真实技术账本\n账本。\n# draft-3\n禁止。",
  });
  try {
    const result = validate(runDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /禁止生成 draft-3/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("frontmatter and UI prompt emphasize comprehension", () => {
  const skill = read("SKILL.md");
  const ui = read("agents/openai.yaml");
  assert.match(skill, /^name: technical-story-explainer$/m);
  assert.match(skill, /能看懂、能复述/);
  assert.match(ui, /正文与账本理解测试/);
  assert.doesNotMatch(ui, /三类审稿/);
});
