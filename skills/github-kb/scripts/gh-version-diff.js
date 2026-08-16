#!/usr/bin/env node
/**
 * gh-version-diff.js — 版本对比：分页采集 Compare API 的 commit 与文件变化
 * 支持双 tag 精确对比和单 tag 自动查找列表中的前一个 tag
 *
 * Usage: node gh-version-diff.js <owner/repo> <tag1> [tag2] [--output-dir <dir>]
 */

const path = require("path");
const {
  gh,
  ensureDir,
  writeArticle,
  today,
  nowIso,
  yamlString,
  safeName,
  validateRepo,
  preflight,
  DEFAULT_OUTPUT_DIR,
} = require("./utils");

const args = process.argv.slice(2);
let outputDir = DEFAULT_OUTPUT_DIR;
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output-dir" && args[i + 1]) {
    outputDir = args[++i];
  } else if (!args[i].startsWith("-")) {
    positional.push(args[i]);
  }
}

const repo = positional[0] || "";
const tag1 = positional[1] || "";
const tag2 = positional[2] || "";

if (!repo || !tag1) {
  console.error('Usage: node gh-version-diff.js <owner/repo> <tag1> [tag2] [--output-dir <dir>]');
  process.exit(1);
}

validateRepo(repo);
preflight();
ensureDir(outputDir);

function flattenPages(value) {
  if (!Array.isArray(value)) return [];
  return Array.isArray(value[0]) ? value.flat() : value;
}

let base;
let head;

if (tag2) {
  base = tag1;
  head = tag2;
} else {
  head = tag1;
  console.log(`==> Finding the previous listed tag for ${head} in ${repo} ...`);
  const tagPages = gh(
    ["api", "--paginate", "--slurp", `repos/${repo}/tags?per_page=100`],
    { json: true }
  );
  const tags = flattenPages(tagPages);
  if (!tags.length) throw new Error(`No tags found in ${repo}`);

  const index = tags.findIndex((tag) => tag.name === head);
  if (index === -1) throw new Error(`Tag "${head}" not found in ${repo}`);
  if (index === tags.length - 1) {
    throw new Error(`No previous listed tag found for "${head}" in ${repo}`);
  }
  base = tags[index + 1].name;
  console.log(`  Found previous listed tag: ${base}`);
}

const encodedBase = encodeURIComponent(base);
const encodedHead = encodeURIComponent(head);
const compareEndpoint = `repos/${repo}/compare/${encodedBase}...${encodedHead}`;

console.log(`==> Comparing ${base}...${head} in ${repo} ...`);
const firstPage = gh(["api", `${compareEndpoint}?per_page=100&page=1`], { json: true });
const totalCommits = firstPage.total_commits || 0;
let allCommits = firstPage.commits || [];

if (allCommits.length < totalCommits) {
  console.log(`  Paginating Compare API (${totalCommits} commits)...`);
  const comparePages = gh(
    ["api", "--paginate", "--slurp", `${compareEndpoint}?per_page=100`],
    { json: true }
  );
  allCommits = comparePages.flatMap((page) => page.commits || []);
}

const uniqueCommits = [];
const seenCommits = new Set();
for (const commit of allCommits) {
  if (!commit.sha || seenCommits.has(commit.sha)) continue;
  seenCommits.add(commit.sha);
  uniqueCommits.push(commit);
}
allCommits = uniqueCommits;

if (allCommits.length !== totalCommits) {
  throw new Error(`Incomplete comparison: collected ${allCommits.length}/${totalCommits} commits`);
}

const baseCommit = gh(["api", `repos/${repo}/commits/${encodedBase}`], { json: true });
const headCommit = gh(["api", `repos/${repo}/commits/${encodedHead}`], { json: true });
const compareUrl = firstPage.html_url || `https://github.com/${repo}/compare/${encodedBase}...${encodedHead}`;
const changedFiles = firstPage.files || [];
const fileCompleteness = changedFiles.length === 300
  ? "unknown (Compare API file cap reached)"
  : "complete for the API response";

const commitRows = allCommits
  .map((commit) => {
    const sha = (commit.sha || "").slice(0, 7);
    const message = ((commit.commit?.message || "").split("\n")[0] || "").replace(/\|/g, "\\|");
    const author = commit.author?.login ? `@${commit.author.login}` : commit.commit?.author?.name || "unknown";
    const date = (commit.commit?.author?.date || "").slice(0, 10);
    return `| ${sha} | ${message} | ${author} | ${date} |`;
  })
  .join("\n");

const fileRows = changedFiles
  .map((file) => {
    const name = (file.filename || "").replace(/\|/g, "\\|");
    const previous = file.previous_filename ? ` ← ${file.previous_filename.replace(/\|/g, "\\|")}` : "";
    return `| ${name}${previous} | ${file.status} | +${file.additions} | -${file.deletions} |`;
  })
  .join("\n");

const fileName = `${safeName(repo)}-version-diff-${safeName(base)}-${safeName(head)}.md`;
const outputFile = path.join(outputDir, fileName);
const accessedAt = nowIso();

const content = `---
repo: ${yamlString(repo)}
generated: ${today()}
type: version-diff
base: ${yamlString(base)}
head: ${yamlString(head)}
base_sha: ${yamlString(baseCommit.sha)}
head_sha: ${yamlString(headCommit.sha)}
total_commits: ${totalCommits}
accessed_at: ${yamlString(accessedAt)}
---

# ${repo} 版本对比：${base} → ${head}

## 概览

| Field | Value |
|---|---|
| Base | ${base} (${baseCommit.sha}) |
| Head | ${head} (${headCommit.sha}) |
| Status | ${firstPage.status || "unknown"} |
| Ahead / Behind | ${firstPage.ahead_by || 0} / ${firstPage.behind_by || 0} |
| Merge Base | ${firstPage.merge_base_commit?.sha || "unknown"} |
| Total Commits | ${totalCommits} |
| Changed Files Collected | ${changedFiles.length}; completeness=${fileCompleteness} |
| URL | ${compareUrl} |

## Changed Files

| File | Status | Additions | Deletions |
|---|---|---:|---:|
${fileRows || "| (none returned) | | | |"}

## Commits

| SHA | Message | Author | Date |
|---|---|---|---|
${commitRows || "| | (no commits) | | |"}

> This is a structured comparison baseline. Read release notes and the decisive file diffs before claiming behavioral or breaking changes.
`;

writeArticle(outputFile, content);
