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
