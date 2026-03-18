# github-kb Version Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gh-version-diff.js` script to github-kb that collects all commits between two version tags of any GitHub repo and outputs a structured markdown document.

**Architecture:** New Node.js script following existing github-kb patterns (data collection only, AI does analysis). Uses Compare API for metadata + List Commits API fallback for full pagination when >250 commits.

**Tech Stack:** Node.js, `gh` CLI, GitHub REST API

**Spec:** `docs/superpowers/specs/2026-03-18-github-kb-version-diff-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `skills/github-kb/scripts/gh-version-diff.js` | Create | New script — argument parsing, tag lookup, commit collection, markdown output |
| `skills/github-kb/SKILL.md` | Modify | Add version diff mode to mode table, new section, script table entry |

No changes to `utils.js` — all needed utilities already exist.

---

### Task 1: Create `gh-version-diff.js` — argument parsing & preflight

**Files:**
- Create: `skills/github-kb/scripts/gh-version-diff.js`

- [ ] **Step 1: Create script with shebang, JSDoc, imports, and argument parsing**

```javascript
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
```

- [ ] **Step 2: Verify script runs with missing args**

Run: `node skills/github-kb/scripts/gh-version-diff.js`
Expected: prints usage message and exits with code 1

- [ ] **Step 3: Commit**

```bash
git add skills/github-kb/scripts/gh-version-diff.js
git commit -m "feat(github-kb): scaffold gh-version-diff.js with arg parsing"
```

---

### Task 2: Single tag mode — find previous tag

**Files:**
- Modify: `skills/github-kb/scripts/gh-version-diff.js`

- [ ] **Step 1: Add tag lookup logic after preflight**

Append after `ensureDir(outputDir);`:

```javascript
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
```

- [ ] **Step 2: Verify single tag mode with a real repo**

Run: `node skills/github-kb/scripts/gh-version-diff.js facebook/react v18.3.1 2>&1 | head -5`
Expected: Shows "Finding previous tag..." and "Found previous tag: ..."

- [ ] **Step 3: Commit**

```bash
git add skills/github-kb/scripts/gh-version-diff.js
git commit -m "feat(github-kb): add single-tag mode with previous tag lookup"
```

---

### Task 3: Commit collection — Compare API + List Commits fallback

**Files:**
- Modify: `skills/github-kb/scripts/gh-version-diff.js`

- [ ] **Step 1: Add commit collection logic after tag resolution**

Append after the tag resolution block:

```javascript
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
```

- [ ] **Step 2: Verify commit collection with a real repo**

Run: `node skills/github-kb/scripts/gh-version-diff.js facebook/react v18.3.0 v18.3.1 2>&1 | head -10`
Expected: Shows compare info and commit count

- [ ] **Step 3: Commit**

```bash
git add skills/github-kb/scripts/gh-version-diff.js
git commit -m "feat(github-kb): add commit collection with Compare API + List Commits fallback"
```

---

### Task 4: Markdown output generation

**Files:**
- Modify: `skills/github-kb/scripts/gh-version-diff.js`

- [ ] **Step 1: Add markdown formatting and file output**

Append after the commit collection block:

```javascript
// --- 格式化输出 ---

console.log(`  [${stepOffset + 2}/${totalSteps}] Generating report`);

const commitRows = allCommits
  .map((c) => {
    const sha = (c.sha || "").slice(0, 7);
    const msg = ((c.commit?.message || "").split("\n")[0] || "").replace(/\|/g, "\\|");
    const author = c.author?.login ? `@${c.author.login}` : c.commit?.author?.name || "unknown";
    const date = (c.commit?.author?.date || "").slice(0, 10);
    return `| ${sha} | ${msg} | ${author} | ${date} |`;
  })
  .join("\n");

const fileName = `${safeName(repo)}-version-diff-${safeName(base)}-${safeName(head)}.md`;
const outputFile = path.join(outputDir, fileName);

const content = `---
repo: ${repo}
generated: ${today()}
type: version-diff
base: ${base}
head: ${head}
total_commits: ${totalCommits}
---

# ${repo} 版本对比：${base} → ${head}

## 概览

| Field | Value |
|-------|-------|
| Base | ${base} |
| Head | ${head} |
| Total Commits | ${totalCommits} |
| URL | ${compareUrl} |

## Commits

| SHA | Message | Author | Date |
|-----|---------|--------|------|
${commitRows || "| | (no commits) | | |"}
`;

writeArticle(outputFile, content);
```

- [ ] **Step 2: End-to-end test with a real repo**

Run: `node skills/github-kb/scripts/gh-version-diff.js facebook/react v18.3.0 v18.3.1 --output-dir /tmp`
Expected: Prints `==> Saved: /tmp/facebook-react-version-diff-v18.3.0-v18.3.1.md`

- [ ] **Step 3: Verify output file content**

Run: `head -20 /tmp/facebook-react-version-diff-v18.3.0-v18.3.1.md`
Expected: YAML frontmatter with `type: version-diff`, overview table, commits table with data

- [ ] **Step 4: Test single tag mode end-to-end**

Run: `node skills/github-kb/scripts/gh-version-diff.js facebook/react v18.3.1 --output-dir /tmp`
Expected: Auto-finds previous tag, generates output file

- [ ] **Step 5: Commit**

```bash
git add skills/github-kb/scripts/gh-version-diff.js
git commit -m "feat(github-kb): add markdown output for version diff"
```

---

### Task 5: Update SKILL.md

**Files:**
- Modify: `skills/github-kb/SKILL.md`

- [ ] **Step 1: Add version diff to mode table**

In `skills/github-kb/SKILL.md`, find the mode table (around line 18-27) and add a new row after the "追踪" row:

```markdown
| 两个版本之间改了什么 | 版本对比 | `scripts/gh-version-diff.js` |
```

- [ ] **Step 2: Add version diff mode section**

After the "追踪模式" section (around line 142), add:

```markdown
### 版本对比模式 — 版本间 commit 汇总

```bash
# 两个 tag 精确对比
node scripts/gh-version-diff.js <owner/repo> <tag1> <tag2> [--output-dir <dir>]

# 一个 tag，自动查找上一个 tag 对比
node scripts/gh-version-diff.js <owner/repo> <tag> [--output-dir <dir>]
```

采集两个版本 tag 之间的全部 commit（SHA、message、author、date），生成版本对比文档。超过 250 commits 时自动分页全量采集。

单 tag 模式会按时间顺序查找上一个 tag 作为 base，适合快速查看最新版本的变更。
```

- [ ] **Step 3: Add script to tool table**

In the script tool table (around line 148-153), add a new row:

```markdown
| `gh-version-diff.js` | 版本对比 | `<owner/repo> <tag1> [tag2] [--output-dir dir]` |
```

- [ ] **Step 4: Verify SKILL.md is valid markdown**

Run: `head -160 skills/github-kb/SKILL.md`
Expected: All three additions visible and properly formatted

- [ ] **Step 5: Commit**

```bash
git add skills/github-kb/SKILL.md
git commit -m "docs(github-kb): add version diff mode to SKILL.md"
```
