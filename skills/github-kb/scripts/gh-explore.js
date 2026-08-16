#!/usr/bin/env node
/**
 * gh-explore.js — 多维度话题探索
 * 一次性搜索 repos + issues + code + PRs，生成综合调研报告
 *
 * Usage: node gh-explore.js "<keyword>" [--language <lang>] [--output-dir <dir>]
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
  preflight,
  DEFAULT_OUTPUT_DIR,
} = require("./utils");

// --- 参数解析 ---
const args = process.argv.slice(2);
let keyword = "";
let language = "";
let outputDir = DEFAULT_OUTPUT_DIR;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--language" && args[i + 1]) {
    language = args[++i];
  } else if (args[i] === "--output-dir" && args[i + 1]) {
    outputDir = args[++i];
  } else if (!args[i].startsWith("-")) {
    keyword = args[i];
  }
}

if (!keyword) {
  console.error('Usage: node gh-explore.js "<keyword>" [--language <lang>] [--output-dir <dir>]');
  process.exit(1);
}

preflight();
ensureDir(outputDir);

const langFlag = language ? ["--language", language] : [];

console.log(`==> Exploring: "${keyword}" ${language ? `(language: ${language})` : ""} ...`);

// --- 多维度搜索 ---

console.log("  [1/4] Searching repos (by stars)...");
const reposData = gh(
  [
    "search",
    "repos",
    keyword,
    "--sort",
    "stars",
    "--limit",
    "10",
    ...langFlag,
    "--json",
    "fullName,stargazersCount,description,updatedAt",
  ],
  { json: true }
);
const repos = reposData?.length
  ? reposData
      .map(
        (r) =>
          `| [${r.fullName}](https://github.com/${r.fullName}) | ${r.stargazersCount} | ${(r.updatedAt || "").slice(0, 10)} | ${(r.description || "N/A").slice(0, 80)} |`
      )
      .join("\n")
  : "| (no results) | | | |";

console.log("  [2/4] Searching closed issues (candidate evidence)...");
const issuesData = gh(
  ["search", "issues", keyword, "--state", "closed", "--limit", "10", "--json", "title,repository,number,url,closedAt"],
  { json: true }
);
const issues = issuesData?.length
  ? issuesData
      .map((i) => `- [${i.repository.nameWithOwner}#${i.number}](${i.url}): ${i.title.slice(0, 100)}`)
      .join("\n")
  : "(no results)";

console.log("  [3/4] Searching code snippets...");
const codeData = gh(
  ["search", "code", keyword, "--limit", "10", ...langFlag, "--json", "repository,path,url,sha"],
  { json: true }
);
const code = codeData?.length
  ? codeData
      .map((c) => `- [${c.repository.nameWithOwner}/${c.path}](${c.url}) — \`${(c.sha || "unknown").slice(0, 12)}\``)
      .join("\n")
  : "(no results)";

console.log("  [4/4] Searching merged PRs...");
const prsData = gh(
  ["search", "prs", keyword, "--merged", "--limit", "10", "--json", "title,repository,number,url,closedAt"],
  { json: true }
);
const prs = prsData?.length
  ? prsData
      .map((p) => `- [${p.repository.nameWithOwner}#${p.number}](${p.url}): ${p.title.slice(0, 100)}`)
      .join("\n")
  : "(no results)";

// --- 生成报告 ---

const outputFile = path.join(outputDir, `explore-${safeName(keyword)}.md`);
const accessedAt = nowIso();

const report = `---
keyword: ${yamlString(keyword)}
language: ${yamlString(language || "all")}
generated: ${today()}
type: exploration
accessed_at: ${yamlString(accessedAt)}
---

# Exploration: ${keyword}

> Generated on ${today()} ${language ? `| Language: ${language}` : ""}

## Top Repositories

| Repo | Stars | Last Updated | Description |
|------|-------|-------------|-------------|
${repos}

## Closed Issues (closure reason not yet verified)

${issues}

## Code Examples (reported SHA is the matched blob, not a resolved repository revision)

${code}

## Merged PRs (Implementation References)

${prs}

---

*Candidate index collected by gh-explore.js. Open the selected sources and verify their content, revision, closure reason, and relevance before drawing conclusions.*
`;

writeArticle(outputFile, report);
