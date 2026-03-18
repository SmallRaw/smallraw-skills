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
