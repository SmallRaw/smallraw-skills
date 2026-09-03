#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const runDirArg = args.find((arg) => !arg.startsWith("--"));
const phaseIndex = args.indexOf("--phase");
const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : "final";

if (!runDirArg || !["upstream", "final"].includes(phase)) {
  console.error("Usage: validate_run.mjs <run-dir> [--phase upstream|final]");
  process.exit(2);
}

const runDir = resolve(runDirArg);
const errors = [];

const contracts = {
  "00-task.md": ["## 任务", "## 正文要悟到", "## 账本要说清", "## 必讲项"],
  "01-facts.md": ["## 事实边界", "## 底层机制", "## 概念坐标", "## 材料边界"],
  "02-story-plan.md": ["## 解释目标", "## 故事方案", "## 正文映射", "## 适配检查", "## 正文禁词", "## 结尾账本"],
};

if (phase === "final") {
  contracts["03-drafts.md"] = ["# draft-1"];
  contracts["04-reviews.md"] = [];
  contracts["05-final.md"] = ["## 产物审计", "## 完整故事定版"];
}

function pathFor(name) {
  return join(runDir, name);
}

function read(name) {
  return readFileSync(pathFor(name), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSection(content, heading) {
  const pattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) return "";
  const remainder = content.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^#{1,2}\s+/m);
  return remainder.slice(0, nextHeading < 0 ? remainder.length : nextHeading).trim();
}

function getDraft(content, label) {
  const pattern = new RegExp(`^# ${escapeRegExp(label)}\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) return "";
  const remainder = content.slice(match.index + match[0].length);
  const nextDraft = remainder.search(/^# \S+/m);
  return remainder.slice(0, nextDraft < 0 ? remainder.length : nextDraft).trim();
}

function getReviewSection(content, label, kind) {
  const heading = `## ${label} ${kind}审稿`;
  const pattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) return "";
  const remainder = content.slice(match.index + match[0].length);
  const reviewHeading = /^## draft-\d+ (?:小白|综合)审稿\s*$/gm;
  let nextReview = -1;
  for (const candidate of remainder.matchAll(reviewHeading)) {
    if (candidate[0].trim() !== heading) {
      nextReview = candidate.index;
      break;
    }
  }
  return remainder.slice(0, nextReview < 0 ? remainder.length : nextReview).trim();
}

function bulletItems(content, heading) {
  return getSection(content, heading)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function listItems(content, heading) {
  const bullets = bulletItems(content, heading);
  if (bullets.length > 0) return bullets;
  return getSection(content, heading)
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim().replace(/[。.]$/, ""))
    .filter(Boolean);
}

function agentId(section) {
  return section.match(/Agent ID\s*[：:]\s*\**\s*([^\s*]+)/)?.[1] ?? "";
}

function validateContract(name, headings) {
  if (!existsSync(pathFor(name))) {
    errors.push(`${name}: 文件不存在`);
    return;
  }
  const content = read(name);
  if (!content.trim()) {
    errors.push(`${name}: 文件为空`);
    return;
  }
  let previous = -1;
  for (const heading of headings) {
    const position = content.indexOf(heading);
    if (position < 0) {
      errors.push(`${name}: 缺少 ${heading}`);
      continue;
    }
    if (position <= previous) errors.push(`${name}: ${heading} 顺序错误`);
    previous = position;
    if (!getSection(content, heading) && heading.startsWith("## ")) {
      errors.push(`${name}: ${heading} 内容为空`);
    }
  }
}

for (const [name, headings] of Object.entries(contracts)) {
  validateContract(name, headings);
}

if (existsSync(pathFor("00-task.md"))) {
  const task = read("00-task.md");
  if (task.split(/\r?\n/, 1)[0] !== "模式：完整故事") {
    errors.push("00-task.md: 第一行必须是 模式：完整故事");
  }
  const bodyQuestions = bulletItems(task, "## 正文要悟到");
  const ledgerQuestions = bulletItems(task, "## 账本要说清");
  const concepts = bulletItems(task, "## 必讲项");
  if (bodyQuestions.length < 1 || bodyQuestions.length > 2) {
    errors.push("00-task.md: 正文要悟到应为 1 到 2 个问题");
  }
  if (ledgerQuestions.length < 1 || ledgerQuestions.length > 4) {
    errors.push("00-task.md: 账本要说清应为 1 到 4 个问题");
  }
  if (concepts.length < 1 || concepts.length > 6) {
    errors.push("00-task.md: 必讲项应为 1 到 6 个概念");
  }
}

if (existsSync(pathFor("02-story-plan.md"))) {
  const plan = read("02-story-plan.md");
  const mappings = getSection(plan, "## 正文映射").match(/^\s*(?:-\s*)?(?:\*\*)?核心机制(?:\*\*)?\s*[：:]\s*(?:\*\*)?/gm) ?? [];
  if (mappings.length < 1 || mappings.length > 2) {
    errors.push("02-story-plan.md: 正文映射必须包含 1 到 2 个核心机制");
  }
  if (!/^\s*-\s*(?:\*\*)?产品化身(?:\*\*)?\s*[：:]\s*(?:\*\*)?\s*无(?:。)?(?:\*\*)?\s*$/m.test(getSection(plan, "## 适配检查"))) {
    errors.push("02-story-plan.md: 适配检查必须明确 产品化身：无");
  }
}

function validateDraftArtifact(content, label) {
  const artifact = getDraft(content, label);
  if (!artifact) {
    errors.push(`03-drafts.md: 缺少 # ${label}`);
    return;
  }
  const body = getSection(artifact, "## 故事正文");
  const ledger = getSection(artifact, "## 真实技术账本");
  if (!body) errors.push(`03-drafts.md: ${label} 缺少故事正文`);
  if (!ledger) errors.push(`03-drafts.md: ${label} 缺少真实技术账本`);

  if (existsSync(pathFor("02-story-plan.md"))) {
    for (const term of listItems(read("02-story-plan.md"), "## 正文禁词")) {
      if (term && body.includes(term)) {
        errors.push(`03-drafts.md: ${label} 故事正文泄漏禁词 ${term}`);
      }
    }
  }
}

function validateReview(content, label, kind) {
  const heading = `## ${label} ${kind}审稿`;
  const section = getReviewSection(content, label, kind);
  if (!section) {
    errors.push(`04-reviews.md: 缺少 ${heading}`);
    return "";
  }
  if (!/审稿方式：独立子 Agent/.test(section)) {
    errors.push(`04-reviews.md: ${heading} 不是独立子 Agent`);
  }
  const id = agentId(section);
  if (!id) errors.push(`04-reviews.md: ${heading} 缺少 Agent ID`);
  if (!/审稿结论：通过/.test(section)) {
    errors.push(`04-reviews.md: ${heading} 没有通过`);
  }

  if (kind === "小白") {
    if (!/正文机制测试：通过/.test(section)) {
      errors.push(`04-reviews.md: ${heading} 正文机制测试没有通过`);
    }
    const bodyResult = /正文理解：\s*\**\s*(\d+)\s*\/\s*(\d+)/.exec(section);
    const ledgerResult = /账本理解：\s*\**\s*(\d+)\s*\/\s*(\d+)/.exec(section);
    if (!bodyResult || Number(bodyResult[1]) !== Number(bodyResult[2]) || Number(bodyResult[2]) < 1) {
      errors.push(`04-reviews.md: ${heading} 正文理解没有全部通过`);
    }
    if (!ledgerResult || Number(ledgerResult[1]) !== Number(ledgerResult[2]) || Number(ledgerResult[2]) < 1) {
      errors.push(`04-reviews.md: ${heading} 账本理解没有全部通过`);
    }
    if (existsSync(pathFor("00-task.md"))) {
      const task = read("00-task.md");
      const expectedBody = bulletItems(task, "## 正文要悟到").length;
      const expectedLedger = bulletItems(task, "## 账本要说清").length;
      if (bodyResult && Number(bodyResult[2]) !== expectedBody) {
        errors.push(`04-reviews.md: ${heading} 正文理解题数与任务不一致`);
      }
      if (ledgerResult && Number(ledgerResult[2]) !== expectedLedger) {
        errors.push(`04-reviews.md: ${heading} 账本理解题数与任务不一致`);
      }
    }
  }

  if (kind === "综合") {
    if (!/硬套检查：通过/.test(section)) {
      errors.push(`04-reviews.md: ${heading} 硬套检查没有通过`);
    }
    const score = /综合评分：\s*\**\s*(\d+)/.exec(section)?.[1];
    if (score === undefined || Number(score) < 90 || Number(score) > 100) {
      errors.push(`04-reviews.md: ${heading} 综合评分必须达到 90`);
    }
  }
  return id;
}

if (phase === "final" && existsSync(pathFor("03-drafts.md"))) {
  const drafts = read("03-drafts.md");
  if (/^# draft-3\s*$/m.test(drafts)) errors.push("03-drafts.md: 禁止生成 draft-3");
  const current = /^# draft-2\s*$/m.test(drafts) ? "draft-2" : "draft-1";
  validateDraftArtifact(drafts, "draft-1");
  if (current === "draft-2") {
    if (!/^# repair-ticket\s*$/m.test(drafts)) {
      errors.push("03-drafts.md: draft-2 缺少 repair-ticket");
    }
    validateDraftArtifact(drafts, "draft-2");
  }

  if (existsSync(pathFor("04-reviews.md"))) {
    const reviews = read("04-reviews.md");
    const noviceId = validateReview(reviews, current, "小白");
    const comprehensiveId = validateReview(reviews, current, "综合");
    if (noviceId && noviceId === comprehensiveId) {
      errors.push("04-reviews.md: 小白与综合审稿必须由不同 Agent 完成");
    }

    if (current === "draft-2") {
      const firstIds = ["小白", "综合"]
        .map((kind) => agentId(getReviewSection(reviews, "draft-1", kind)))
        .filter(Boolean);
      if (firstIds.length !== 2) errors.push("04-reviews.md: draft-2 缺少第一轮审稿记录");
      if (firstIds.includes(noviceId) || firstIds.includes(comprehensiveId)) {
        errors.push("04-reviews.md: draft-2 必须由全新 Reviewer 复审");
      }
    }
  }
}

if (phase === "final" && existsSync(pathFor("05-final.md"))) {
  const final = read("05-final.md");
  if (!/upstream validator：通过/.test(final)) {
    errors.push("05-final.md: upstream validator 没有明确通过");
  }
  if (!/final validator：通过/.test(final)) {
    errors.push("05-final.md: final validator 没有明确通过");
  }
  const finalStart = final.indexOf("## 完整故事定版");
  const delivery = finalStart >= 0 ? final.slice(finalStart) : "";
  if (!/^### 故事正文\s*$/m.test(delivery) || !/^### 真实技术账本\s*$/m.test(delivery)) {
    errors.push("05-final.md: 完整故事定版缺少故事正文或真实技术账本");
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`INVALID ${error}`);
  process.exit(1);
}

console.log(`VALID ${phase} ${basename(runDir)}`);
