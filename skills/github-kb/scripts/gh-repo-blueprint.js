#!/usr/bin/env node
/**
 * gh-repo-blueprint.js — 生成仓库蓝图文档
 * 采集元信息、语言分布、目录结构、Release、Issue、PR、贡献者、同类项目
 * 不做分析，只做结构化数据采集，分析由 AI 完成
 *
 * Usage: node gh-repo-blueprint.js <owner/repo> [output-dir]
 */

const path = require("path");
const { gh, ensureDir, writeArticle, today, safeName, preflight, DEFAULT_OUTPUT_DIR } = require("./utils");

const repo = process.argv[2];
const outputDir = process.argv[3] || DEFAULT_OUTPUT_DIR;

if (!repo) {
  console.error("Usage: node gh-repo-blueprint.js <owner/repo> [output-dir]");
  process.exit(1);
}

preflight();
ensureDir(outputDir);

console.log(`==> Generating blueprint for ${repo} ...`);

// --- 采集数据 ---

console.log("  [1/8] Repo metadata");
const meta = gh(
  `repo view ${repo} --json name,description,stargazerCount,forkCount,primaryLanguage,licenseInfo,createdAt,pushedAt,url,homepageUrl,repositoryTopics,defaultBranchRef,isArchived,isFork`,
  { json: true }
);
if (!meta) {
  console.error(`Error: Cannot access repo ${repo}`);
  process.exit(1);
}

const name = meta.name;
const desc = meta.description || "N/A";
const stars = meta.stargazerCount;
const forks = meta.forkCount;
const lang = meta.primaryLanguage?.name || "N/A";
const license = meta.licenseInfo?.name || "N/A";
const created = (meta.createdAt || "").slice(0, 10);
const updated = (meta.pushedAt || "").slice(0, 10);
const url = meta.url;
const homepage = meta.homepageUrl || "N/A";
const topicsList = (meta.repositoryTopics || []).map((t) => t.name);
const topics = topicsList.join(", ") || "N/A";
const archived = meta.isArchived;
const isFork = meta.isFork;
const defaultBranch = meta.defaultBranchRef?.name || "main";

console.log("  [2/8] Language distribution");
const langData = gh(`api repos/${repo}/languages`, { json: true });
let langBreakdown = "(unable to fetch)";
if (langData && typeof langData === "object") {
  const totalBytes = Object.values(langData).reduce((a, b) => a + b, 0);
  if (totalBytes > 0) {
    langBreakdown = Object.entries(langData)
      .sort((a, b) => b[1] - a[1])
      .map(([name, bytes]) => {
        const pct = ((bytes / totalBytes) * 100).toFixed(1);
        return `- ${name}: ${pct}%`;
      })
      .join("\n");
  }
}

console.log("  [3/8] Directory structure");
const treeData = gh(`api repos/${repo}/git/trees/${defaultBranch}`, { json: true });
let tree = "(unable to fetch)";
if (treeData?.tree) {
  const items = treeData.tree.slice(0, 60);
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = i === items.length - 1;
    const prefix = isLast ? "└── " : "├── ";
    const suffix = item.type === "tree" ? "/" : "";
    lines.push(`${prefix}${item.path}${suffix}`);
  }
  tree = lines.join("\n");
}

console.log("  [4/8] Releases");
const releasesData = gh(`api "repos/${repo}/releases?per_page=5"`, { json: true });
const releases = releasesData?.length
  ? releasesData.map((r) => `- **${r.tag_name}** (${(r.published_at || "").slice(0, 10)}): ${r.name || r.tag_name}`).join("\n")
  : "(no releases)";

console.log("  [5/8] Top open issues");
const issuesData = gh(`issue list --repo ${repo} --limit 10 --state open --json number,title,labels,createdAt`, { json: true });
const issues = issuesData?.length
  ? issuesData
      .map((i) => {
        const labels = i.labels?.length ? ` (\`${i.labels.map((l) => l.name).join("`, `")}\`)` : "";
        return `- [#${i.number}](https://github.com/${repo}/issues/${i.number}) ${i.title}${labels}`;
      })
      .join("\n")
  : "(no open issues)";

console.log("  [6/8] Recently merged PRs");
const prsData = gh(`pr list --repo ${repo} --state merged --limit 5 --json number,title,mergedAt`, { json: true });
const prs = prsData?.length
  ? prsData
      .map((p) => `- [#${p.number}](https://github.com/${repo}/pull/${p.number}) ${p.title} (${(p.mergedAt || "").slice(0, 10)})`)
      .join("\n")
  : "(no merged PRs)";

console.log("  [7/8] Top contributors");
const contribData = gh(`api "repos/${repo}/contributors?per_page=10"`, { json: true });
const contributors = contribData?.length
  ? contribData.map((c) => `- [@${c.login}](https://github.com/${c.login}) — ${c.contributions} commits`).join("\n")
  : "(unable to fetch)";

console.log("  [8/8] Similar repos");
// 多策略搜索同类项目：先用描述关键词 + 语言，再用 topics
const descWords = desc
  .replace(/[^\w\s]/g, " ")
  .split(/\s+/)
  .filter((w) => w.length > 3)
  .slice(0, 4)
  .join(" ");
const langFilter = lang !== "N/A" ? `--language ${lang}` : "";

// 策略1：用描述关键词搜索
const similar1 = gh(
  `search repos "${descWords}" --sort stars --limit 8 ${langFilter} --json fullName,stargazersCount,description,updatedAt`,
  { json: true }
) || [];

// 策略2：用第一个 topic 搜索（更广泛）
const topicSearch = topicsList[0] || "";
const similar2 = topicSearch
  ? gh(
      `search repos "${topicSearch}" --sort stars --limit 8 ${langFilter} --json fullName,stargazersCount,description,updatedAt`,
      { json: true }
    ) || []
  : [];

// 合并去重，排除自身，按 star 排序
const seen = new Set();
const merged = [...similar1, ...similar2]
  .filter((r) => {
    if (!r?.fullName || r.fullName === repo || seen.has(r.fullName)) return false;
    seen.add(r.fullName);
    return true;
  })
  .sort((a, b) => b.stargazersCount - a.stargazersCount)
  .slice(0, 5);

let similarRepos = "(unable to fetch)";
if (merged.length) {
  similarRepos = merged
    .map(
      (r) =>
        `| [${r.fullName}](https://github.com/${r.fullName}) | ${r.stargazersCount} | ${(r.updatedAt || "").slice(0, 10)} | ${(r.description || "N/A").slice(0, 80)} |`
    )
    .join("\n");
}

// --- 生成蓝图 ---

const outputFile = path.join(outputDir, `${safeName(repo)}-blueprint.md`);

const blueprint = `---
repo: ${repo}
generated: ${today()}
type: blueprint
---

# ${name} Blueprint

> ${desc}

## 概览

| Field | Value |
|-------|-------|
| URL | ${url} |
| Homepage | ${homepage} |
| Stars | ${stars} |
| Forks | ${forks} |
| Primary Language | ${lang} |
| License | ${license} |
| Created | ${created} |
| Last Push | ${updated} |
| Topics | ${topics} |
| Archived | ${archived} |
| Is Fork | ${isFork} |

## 语言分布

${langBreakdown}

## 目录结构

\`\`\`
${tree}
\`\`\`

## 最新 Releases

${releases}

## 热门 Open Issues

${issues}

## 近期合并 PRs

${prs}

## 核心贡献者

${contributors}

## 同类项目

| Repo | Stars | Last Updated | Description |
|------|-------|-------------|-------------|
${similarRepos}

---

> 以上为脚本自动采集的原始数据。接下来请阅读该仓库的 README（\`gh repo view ${repo}\`），结合以上数据完成架构分析、线稿图、竞品对比和中文总结。
`;

writeArticle(outputFile, blueprint);
