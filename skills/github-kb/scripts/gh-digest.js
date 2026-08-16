#!/usr/bin/env node
/**
 * gh-digest.js — 生成 Issue/PR 摘要文档
 * 采集正文、评论、标签；PR 额外包含变更文件和代码量统计
 *
 * Usage: node gh-digest.js <issue|pr> <owner/repo> <number> [output-dir]
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
  validatePositiveInteger,
  preflight,
  DEFAULT_OUTPUT_DIR,
} = require("./utils");

const type = process.argv[2];
const repo = process.argv[3];
const number = process.argv[4];
const outputDir = process.argv[5] || DEFAULT_OUTPUT_DIR;

if (!type || !repo || !number || !["issue", "pr"].includes(type)) {
  console.error("Usage: node gh-digest.js <issue|pr> <owner/repo> <number> [output-dir]");
  process.exit(1);
}

validateRepo(repo);
validatePositiveInteger(number, `${type} number`);
preflight();
ensureDir(outputDir);

console.log(`==> Generating ${type} digest for ${repo}#${number} ...`);

if (type === "issue") {
  // --- Issue 摘要 ---
  console.log("  [1/2] Issue details");
  const data = gh(
    [
      "issue",
      "view",
      number,
      "--repo",
      repo,
      "--json",
      "title,body,author,createdAt,closedAt,state,labels,comments,url",
    ],
    { json: true }
  );
  if (!data) {
    console.error(`Error: Cannot access issue #${number} in ${repo}`);
    process.exit(1);
  }

  console.log("  [2/2] Formatting comments");
  const commentCount = data.comments?.length || 0;
  const comments = (data.comments || [])
    .map((c) => `### @${c.author?.login || "ghost"} (${(c.createdAt || "").slice(0, 10)})\n\n${c.body}\n\n---`)
    .join("\n\n");

  const labels = (data.labels || []).map((l) => l.name).join(", ") || "N/A";
  const outputFile = path.join(outputDir, `${safeName(repo)}-issue-${number}.md`);
  const accessedAt = nowIso();

  const content = `---
repo: ${yamlString(repo)}
number: ${number}
generated: ${today()}
type: digest
source: issue
accessed_at: ${yamlString(accessedAt)}
---

# Issue #${number}: ${data.title}

| Field | Value |
|-------|-------|
| URL | ${data.url} |
| Author | @${data.author?.login || "ghost"} |
| State | ${data.state} |
| Created | ${(data.createdAt || "").slice(0, 10)} |
| Closed | ${data.closedAt ? data.closedAt.slice(0, 10) : "open"} |
| Labels | ${labels} |
| Comments | ${commentCount} |

## Body

${data.body || "(empty)"}

## Comments

${comments || "(no comments)"}
`;

  writeArticle(outputFile, content);
} else {
  // --- PR 摘要 ---
  console.log("  [1/3] PR details");
  const data = gh(
    [
      "pr",
      "view",
      number,
      "--repo",
      repo,
      "--json",
      "title,body,author,createdAt,closedAt,mergedAt,state,labels,comments,url,additions,deletions,changedFiles,baseRefName,headRefName,reviewDecision",
    ],
    { json: true }
  );
  if (!data) {
    console.error(`Error: Cannot access PR #${number} in ${repo}`);
    process.exit(1);
  }

  console.log("  [2/3] Changed files");
  const filePages = gh(
    ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files?per_page=100`],
    { json: true }
  );
  const allFiles = Array.isArray(filePages?.[0]) ? filePages.flat() : filePages || [];
  const files = allFiles
    .map((f) => {
      const rename = f.previous_filename ? ` (from \`${f.previous_filename}\`)` : "";
      return `- \`${f.filename}\`${rename} — ${f.status} (+${f.additions} -${f.deletions})`;
    })
    .join("\n") || "(no file details)";

  console.log("  [3/3] Formatting comments");
  const commentCount = data.comments?.length || 0;
  const comments = (data.comments || [])
    .map((c) => `### @${c.author?.login || "ghost"} (${(c.createdAt || "").slice(0, 10)})\n\n${c.body}\n\n---`)
    .join("\n\n");

  const labels = (data.labels || []).map((l) => l.name).join(", ") || "N/A";
  const outputFile = path.join(outputDir, `${safeName(repo)}-pr-${number}.md`);
  const accessedAt = nowIso();

  const content = `---
repo: ${yamlString(repo)}
number: ${number}
generated: ${today()}
type: digest
source: pr
accessed_at: ${yamlString(accessedAt)}
---

# PR #${number}: ${data.title}

| Field | Value |
|-------|-------|
| URL | ${data.url} |
| Author | @${data.author?.login || "ghost"} |
| State | ${data.state} |
| Branch | ${data.headRefName} -> ${data.baseRefName} |
| Created | ${(data.createdAt || "").slice(0, 10)} |
| Merged | ${data.mergedAt ? data.mergedAt.slice(0, 10) : "not merged"} |
| Review | ${data.reviewDecision || "N/A"} |
| Labels | ${labels} |
| Changes | +${data.additions} -${data.deletions} across ${data.changedFiles} files |
| Files collected | ${allFiles.length}/${data.changedFiles} |
| Comments | ${commentCount} |

## Body

${data.body || "(empty)"}

## Changed Files

${files}

## Comments

${comments || "(no comments)"}

> This digest includes conversation comments and the complete changed-file list. Reviews and inline review threads are not collected here; fetch them in Deep mode when the design rationale depends on review discussion.
`;

  writeArticle(outputFile, content);
}
