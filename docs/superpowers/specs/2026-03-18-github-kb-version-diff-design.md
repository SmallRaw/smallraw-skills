# github-kb 版本对比功能设计

## 概述

为 github-kb skill 新增 `gh-version-diff.js` 脚本，支持采集任意 GitHub 仓库两个版本 tag 之间的全部 commit，生成结构化 markdown 文档。

## 用法

```bash
# 两个 tag 精确对比
node gh-version-diff.js <owner/repo> <tag1> <tag2> [output-dir]

# 一个 tag，自动查找上一个 tag 进行对比
node gh-version-diff.js <owner/repo> <tag> [output-dir]
```

**参数解析**：采用与 `gh-explore.js` 一致的 flag 风格处理 output-dir。位置参数依次为 `repo`、`tag1`、`tag2`（可选）。`output-dir` 通过 `--output-dir <dir>` 指定，默认 `~/docs/github-article/`。

## 执行流程

```
[1/5] Preflight — gh 认证检查（复用 utils.preflight）
[2/5] 解析参数 — 判断单 tag / 双 tag 模式
[3/5] (单 tag 时) 查找上一个 tag
      — gh api repos/{owner}/{repo}/tags?per_page=100
      — API 返回按时间倒序的 tag 列表
      — 找到目标 tag 位置，取下一个（更早的）作为 base
      — 找不到目标 tag 或没有上一个 tag 时报错退出
[4/5] 采集 commits
      — 先调用 Compare API 获取元信息（total_commits、compare URL）
      — 若 total_commits ≤ 250，直接使用 Compare API 返回的 commits
      — 若 total_commits > 250（被截断），切换到 List Commits API 全量分页采集
[5/5] 格式化输出 + 写文件
```

## 采集策略（混合方案）

GitHub Compare API (`repos/{owner}/{repo}/compare/{base}...{head}`) 不支持分页，最多返回 250 commits。采用混合策略实现全量采集：

### 第一步：Compare API 获取元信息

```
gh api repos/{owner}/{repo}/compare/{base}...{head}
```

从响应中提取：
- `total_commits` — 总 commit 数
- `html_url` — 对比页面 URL
- `commits` — commit 数组（最多 250 条）

### 第二步：判断是否需要全量采集

- 若 `total_commits ≤ 250`：直接使用 Compare API 返回的 `commits`，采集完毕
- 若 `total_commits > 250`：Compare API 的 commits 被截断，需要切换策略

### 第三步：List Commits API 全量采集（仅截断时）

```
gh api "repos/{owner}/{repo}/commits?sha={head}&per_page=100&page=N"
```

逻辑：
1. 先获取 base tag 对应的 commit SHA（从 Compare API 响应的 `base_commit.sha` 取得）
2. 从 head 开始分页遍历 commits（per_page=100）
3. 每页检查是否包含 base SHA，包含则截止（不含 base commit 本身）
4. 累积所有 commits 到数组中

**注意**：tag 名称中若含特殊字符（如 `+`、`/`），传入 API 路径时需 `encodeURIComponent()` 编码。

## 单 tag 查找上一个 tag 的逻辑

1. 调用 `gh api repos/{owner}/{repo}/tags?per_page=100` 获取 tag 列表（API 按时间倒序返回）
2. 在列表中找到目标 tag 的位置
3. 取其下一个（更早的）tag 作为 base
4. 如果目标 tag 不在前 100 个中，或者它是最早的 tag，报错提示

**注意**：此排序基于 tag 底层 commit 的创建时间，非语义版本排序。对有 backport 的仓库（如在 v1.3.0 之后打 v1.2.5），结果可能不符合版本语义。需要精确控制时建议使用双 tag 模式。

## 输出格式

文件名：`{safeName(owner/repo)}-version-diff-{safeName(base)}-{safeName(head)}.md`

通过 `safeName()` 处理 tag 名中的特殊字符（`/`、`+` 等）。

```markdown
---
repo: owner/repo
generated: YYYY-MM-DD
type: version-diff
base: v1.0.0
head: v1.1.0
total_commits: 42
---

# owner/repo 版本对比：v1.0.0 → v1.1.0

## 概览

| Field | Value |
|-------|-------|
| Base | v1.0.0 |
| Head | v1.1.0 |
| Total Commits | 42 |
| URL | https://github.com/owner/repo/compare/v1.0.0...v1.1.0 |

## Commits

| SHA | Message | Author | Date |
|-----|---------|--------|------|
| a1b2c3d | fix: resolve memory leak | @octocat | 2024-01-15 |
| ... | ... | ... | ... |
```

## Commit 字段

每条 commit 采集以下字段：
- **SHA**：前 7 位短哈希
- **Message**：commit message 首行
- **Author**：commit 作者的 login（带 @ 前缀）；fallback 到 `commit.author.name`
- **Date**：commit 日期（YYYY-MM-DD）

## 脚本规范（与现有脚本一致）

- 文件头：`#!/usr/bin/env node` + JSDoc 注释块（脚本说明 + Usage）
- 首行动作：`preflight()` + `ensureDir(outputDir)`
- 进度日志：`console.log("  [N/M] 步骤描述")`
- 错误提示：`console.error("Error: 具体描述")` + `process.exit(1)`
- 写文件：`writeArticle(outputFile, content)`

## SKILL.md 变更

1. 工作模式表新增一行：

| 意图 | 模式 | 核心方法 |
|------|------|----------|
| 两个版本之间改了什么 | 版本对比 | `scripts/gh-version-diff.js` |

2. 新增"版本对比模式"章节，包含用法示例

3. 脚本工具表新增：

| 脚本 | 用途 | 核心参数 |
|------|------|----------|
| `gh-version-diff.js` | 版本对比 | `<owner/repo> <tag1> [tag2] [--output-dir dir]` |

## 依赖

- 复用 `utils.js`：gh, ensureDir, writeArticle, today, safeName, preflight, DEFAULT_OUTPUT_DIR
- 无需新增工具函数
- 无外部依赖，仅需 `gh` CLI

## 边界情况

- 目标 tag 不存在：Compare API 返回 404，脚本报错 `Error: Cannot compare {base}...{head} in {repo} (tag may not exist)` 并退出
- 单 tag 模式找不到上一个 tag：报错 `Error: No previous tag found for {tag} in {repo}`
- 两个 tag 之间无 commit：输出空表格，Total Commits 显示 0
- List Commits API 分页中断：任何一页失败则停止采集，输出已采集的部分并在控制台打印警告
- tag 名含特殊字符：通过 `encodeURIComponent()` 编码后传入 API
