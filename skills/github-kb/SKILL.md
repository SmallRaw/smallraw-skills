---
name: github-kb
description: "If the user's message contains an owner/repo string (e.g. facebook/react, tokio-rs/tokio, vercel/next.js), a github.com URL, or mentions searching/exploring GitHub in any language (GitHub上搜, GitHub上有没有, 搜一下GitHub, explore GitHub, GitHub上探索) — invoke this skill immediately. It is the sole gateway to remote GitHub repositories: architecture analysis, blueprints, library discovery, issue/PR search, open-source topic research, ~/docs/github-article. Skip for: local project analysis, local git, CI/CD setup, writing code, general programming."
user-invocable: false
disable-model-invocation: false
---

# GitHub 知识库

GitHub 是世界上最大的开源知识库。这个 skill 通过 `gh` CLI 把它变成你的实时检索引擎——搜索、分析、总结、归档，一条龙完成。

脚本会自动检查 gh 认证状态，未认证或版本过低时会提示用户。

## 工作模式

根据用户意图选择模式：

| 意图 | 模式 | 核心方法 |
|------|------|----------|
| 找什么库能做 X | 发现 | `gh search repos` |
| 这个报错怎么解决 | 排错 | `gh search issues --state closed` |
| 这个功能怎么实现的 | 学习 | `gh search prs` + `gh search code` |
| 了解某个仓库全貌 | 蓝图 | `scripts/gh-repo-blueprint.js` |
| 某个 Issue/PR 的详情 | 摘要 | `scripts/gh-digest.js` |
| 某个话题的全面调研 | 探索 | `scripts/gh-explore.js` |
| 追踪代码变更历史 | 追踪 | `gh search commits` |
| 两个版本之间改了什么 | 版本对比 | `scripts/gh-version-diff.js` |

## 执行流程

```
1. 分析意图 → 选择模式
2. 执行检索 → gh search / 脚本
3. 深度分析 → 阅读关键内容，提炼要点
4. 输出归档 → 保存到 ~/docs/github-article/
```

## 各模式详解

### 发现模式 — 找库

```bash
# 按 star 排序（最受欢迎）
gh search repos "<关键词>" --sort stars --limit 10

# 按语言筛选
gh search repos "<关键词>" --language python --stars ">1000"

# 最近活跃（近期更新）
gh search repos "<关键词>" --sort updated --order desc --limit 10

# 近期新星（模拟 trending）
gh search repos "<关键词>" --sort stars --stars ">100" --json fullName,stargazersCount,description,updatedAt --limit 10
```

找到候选后，用蓝图脚本深度分析：

```bash
node scripts/gh-repo-blueprint.js <owner/repo>
```

**输出要求**：列出项目名、Star 数、最后更新、一句话简介、适用场景。

### 排错模式 — 搜报错

```bash
# 搜已关闭的 issue（里面有解决方案）
gh search issues "<报错关键信息>" --state closed --limit 10

# 在特定仓库中搜
gh search issues "<报错信息>" --repo owner/repo --state closed --limit 5

# 按标签筛选
gh search issues "<报错信息>" --label bug --state closed --limit 5
```

找到相关 issue 后看详情：

```bash
node scripts/gh-digest.js issue <owner/repo> <number>
```

**关键逻辑**：优先搜 `closed` issue，因为里面通常包含解决方案。如果 closed 结果不够，再搜 open 的。

### 学习模式 — 看实现

```bash
# 搜已合并的 PR（看别人怎么实现的）
gh search prs "<功能描述>" --state merged --limit 5

# 搜代码片段
gh search code "<函数名或 API>" --language typescript --limit 10

# 按文件类型搜
gh search code "<配置项>" --extension yaml --limit 10

# 按路径搜
gh search code "<关键词>" --path "src/" --limit 10
```

### 蓝图模式 — 仓库全貌

```bash
node scripts/gh-repo-blueprint.js <owner/repo> [output-dir]
```

脚本采集结构化数据（元信息、语言分布、目录结构、Releases、Issues、PRs、贡献者、同类项目）。脚本跑完后：

1. 用 `gh repo view <owner/repo>` 阅读完整 README，理解项目背景
2. 按 `references/blueprint-format.md` 的结构撰写蓝图（中文、含线稿图、含设计亮点分析）
3. 原始数据保留原文放折叠区

默认保存到 `~/docs/github-article/`。

### 摘要模式 — Issue/PR 详情

```bash
# Issue 摘要
node scripts/gh-digest.js issue <owner/repo> <number> [output-dir]

# PR 摘要
node scripts/gh-digest.js pr <owner/repo> <number> [output-dir]
```

生成包含正文、评论、标签、时间线的完整摘要。PR 额外包含变更文件列表和代码量统计。

### 探索模式 — 话题调研

```bash
node scripts/gh-explore.js "<关键词>" [--language <lang>] [--output-dir <dir>]
```

一次性执行多维度搜索（repos + issues + code + PRs），生成综合调研报告。适合技术选型、方案调研。

### 追踪模式 — 代码历史

```bash
# 搜提交信息
gh search commits "fix memory leak" --repo owner/repo --limit 5

# 按作者搜
gh search commits "refactor" --author octocat --limit 5
```

### 版本对比模式 — 版本间 commit 汇总

```bash
# 两个 tag 精确对比
node scripts/gh-version-diff.js <owner/repo> <tag1> <tag2> [--output-dir <dir>]

# 一个 tag，自动查找上一个 tag 对比
node scripts/gh-version-diff.js <owner/repo> <tag> [--output-dir <dir>]
```

采集两个版本 tag 之间的全部 commit（SHA、message、author、date），生成版本对比文档。超过 250 commits 时自动分页全量采集。

单 tag 模式会按时间顺序查找上一个 tag 作为 base，适合快速查看最新版本的变更。

## 脚本工具

所有脚本位于本 skill 的 `scripts/` 目录。执行前先 `cd` 到本 skill 目录。

| 脚本 | 用途 | 核心参数 |
|------|------|----------|
| `gh-repo-blueprint.js` | 仓库蓝图 | `<owner/repo> [output-dir]` |
| `gh-digest.js` | Issue/PR 摘要 | `<issue\|pr> <owner/repo> <number> [output-dir]` |
| `gh-explore.js` | 话题探索 | `"<keyword>" [--language X] [--output-dir dir]` |
| `gh-version-diff.js` | 版本对比 | `<owner/repo> <tag1> [tag2] [--output-dir dir]` |

默认输出目录：`~/docs/github-article/`

脚本只负责数据采集和格式化。拿到原始数据后，由你来做智能总结——提炼核心观点、归纳技术方案、标注关键发现。

## 输出规范

所有生成的文档保存到 `~/docs/github-article/`，文件名格式 `<owner>-<repo>-<type>.md`。

**语言要求**：所有输出文档必须使用**中文**撰写。脚本采集的原始数据（英文 README、Issue 正文等）保留原文放在折叠区域，但架构分析、总结、关键发现等你撰写的内容一律用中文。

文档带 YAML frontmatter：

```yaml
---
repo: owner/repo          # 或 keyword（探索模式）
generated: 2024-01-01
type: blueprint | digest | exploration
---
```

## 高级用法

当 `gh search` 无法满足需求时，可直接调用 GitHub REST/GraphQL API。完整命令参考见 `references/search-commands.md`。

```bash
# REST API 示例
gh api repos/{owner}/{repo}
gh api "repos/{owner}/{repo}/releases?per_page=5" --jq '.[].tag_name'
```

蓝图格式模板见 `references/blueprint-format.md`。
