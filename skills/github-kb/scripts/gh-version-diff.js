#!/usr/bin/env node
/**
 * gh-version-diff.js — 版本对比：采集两个 tag 之间的全部 commit
 * 支持双 tag 精确对比和单 tag 自动查找上一个 tag
 *
 * Usage: node gh-version-diff.js <owner/repo> <tag1> [tag2] [--output-dir <dir>]
 */

const path = require("path");
const { gh, ensureDir, writeArticle, today, safeName, preflight, DEFAULT_OUTPUT_DIR } = require("./utils");

// --- 参数解析 ---
const args = process.argv.slice(2);
let repo = "";
let tag1 = "";
let tag2 = "";
let outputDir = DEFAULT_OUTPUT_DIR;

const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output-dir" && args[i + 1]) {
    outputDir = args[++i];
  } else if (!args[i].startsWith("-")) {
    positional.push(args[i]);
  }
}

repo = positional[0] || "";
tag1 = positional[1] || "";
tag2 = positional[2] || "";

if (!repo || !tag1) {
  console.error('Usage: node gh-version-diff.js <owner/repo> <tag1> [tag2] [--output-dir <dir>]');
  process.exit(1);
}

preflight();
ensureDir(outputDir);

let base, head;

if (tag2) {
  // 双 tag 模式
  base = tag1;
  head = tag2;
  console.log(`==> Comparing ${base}...${head} in ${repo} ...`);
} else {
  // 单 tag 模式：查找上一个 tag
  head = tag1;
  console.log(`==> Finding previous tag for ${head} in ${repo} ...`);

  console.log("  [1/4] Fetching tag list");
  const tags = gh(`api "repos/${repo}/tags?per_page=100"`, { json: true });
  if (!tags || !tags.length) {
    console.error(`Error: No tags found in ${repo}`);
    process.exit(1);
  }

  const idx = tags.findIndex((t) => t.name === head);
  if (idx === -1) {
    console.error(`Error: Tag "${head}" not found in the latest 100 tags of ${repo}`);
    process.exit(1);
  }
  if (idx === tags.length - 1) {
    console.error(`Error: No previous tag found for "${head}" in ${repo} (it is the earliest tag)`);
    process.exit(1);
  }

  base = tags[idx + 1].name;
  console.log(`  Found previous tag: ${base}`);
  console.log(`==> Comparing ${base}...${head} in ${repo} ...`);
}

// --- 采集 commits ---

const totalSteps = tag2 ? 3 : 4; // 双 tag: 3 步，单 tag: 4 步（多一步查找 tag）
const stepOffset = tag2 ? 1 : 2; // 单 tag 模式从 step 2 开始，双 tag 从 step 1

const encBase = encodeURIComponent(base);
const encHead = encodeURIComponent(head);

console.log(`  [${stepOffset}/${totalSteps}] Fetching compare info`);
const compare = gh(`api "repos/${repo}/compare/${encBase}...${encHead}"`, { json: true });
if (!compare) {
  console.error(`Error: Cannot compare ${base}...${head} in ${repo} (tag may not exist)`);
  process.exit(1);
}

const totalCommits = compare.total_commits || 0;
const compareUrl = compare.html_url || `https://github.com/${repo}/compare/${base}...${head}`;
let allCommits = compare.commits || [];

console.log(`  Total commits: ${totalCommits}`);

// Compare API 最多返回 250 commits，超过需要用 List Commits API 全量采集
if (totalCommits > 250) {
  console.log(`  [${stepOffset + 1}/${totalSteps}] Paginating all commits (${totalCommits} total)...`);
  const baseSha = compare.base_commit?.sha;
  if (!baseSha) {
    console.error("Error: Cannot determine base commit SHA for pagination");
    process.exit(1);
  }

  allCommits = [];
  let page = 1;
  let done = false;

  while (!done) {
    const pageData = gh(
      `api "repos/${repo}/commits?sha=${encHead}&per_page=100&page=${page}"`,
      { json: true }
    );
    if (!pageData || !pageData.length) {
      console.warn(`Warning: Pagination stopped at page ${page} (API returned no data), collected ${allCommits.length}/${totalCommits} commits`);
      break;
    }

    for (const c of pageData) {
      if (c.sha === baseSha) {
        done = true;
        break;
      }
      allCommits.push(c);
    }
    page++;
    // 安全上限：防止无限循环
    if (page > 200) {
      console.warn("Warning: Reached page limit (200), stopping pagination");
      break;
    }
  }
  console.log(`  Collected ${allCommits.length} commits`);
} else {
  console.log(`  [${stepOffset + 1}/${totalSteps}] Using compare API data (${allCommits.length} commits)`);
}
