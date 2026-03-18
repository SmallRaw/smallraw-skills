---
name: github-kb
description: "If the user's message contains an owner/repo string (e.g. facebook/react, tokio-rs/tokio, vercel/next.js), a github.com URL, or mentions searching/exploring GitHub in any language (GitHub上搜, GitHub上有没有, 搜一下GitHub, explore GitHub, GitHub上探索) — invoke this skill immediately. It is the sole gateway to remote GitHub repositories: architecture analysis, blueprints, library discovery, issue/PR search, open-source topic research, ~/docs/github-article. Skip for: local project analysis, local git, CI/CD setup, writing code, general programming."
user-invocable: false
disable-model-invocation: false
---

# GitHub 知识库

通过 `gh` CLI 把 GitHub 变成实时检索引擎——搜索、分析、总结、归档。

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

## 核心规则

1. **意图驱动选模式**：先判断用户要什么，再选对应模式。不确定时问用户
2. **脚本采集，AI 分析**：脚本只负责结构化数据采集，拿到原始数据后由你做智能总结——提炼核心观点、归纳技术方案、标注关键发现
3. **中文归档**：所有输出保存到 `~/docs/github-article/`，用中文撰写，原始英文数据放折叠区。详见 `references/output-spec.md`
4. **脚本执行**：先 `cd` 到本 skill 目录再执行脚本
5. **蓝图必须有分析**：蓝图模式跑完脚本后，必须用 `gh repo view <owner/repo>` 阅读 README，再按 `references/blueprint-format.md` 撰写完整蓝图（含线稿图、设计亮点分析）

## Gotchas

1. **这个 skill 只操作远程 GitHub 仓库**。本地 git 操作、本地项目分析不要用这个 skill
2. **排错优先搜 closed issue**。closed issue 里有解决方案，open 的通常只有问题描述。先搜 `--state closed`，不够再搜 open
3. **Compare API 有 250 commit 上限**。version-diff 脚本超过 250 时会自动切换到 List Commits API 分页采集，不需要手动处理
4. **单 tag 模式按时间排序找上一个 tag，不是语义版本排序**。对有 backport 的仓库（如在 v1.3.0 之后打 v1.2.5），结果可能不是语义上的"上一个版本"。需要精确控制时用双 tag 模式
5. **gh 有速率限制**。短时间大量 `gh search` 会被 GitHub 限流，遇到空结果时考虑是否被限流
6. **gh 未认证时脚本会报错**。脚本有 preflight 检查，会提示用户 `gh auth login`

## 极简用法速查

```bash
# 发现 — 找库
gh search repos "<关键词>" --sort stars --limit 10

# 排错 — 搜已解决的 issue
gh search issues "<报错信息>" --state closed --limit 10

# 学习 — 看实现
gh search prs "<功能描述>" --state merged --limit 5
gh search code "<函数名>" --language typescript --limit 10

# 追踪 — 搜 commit
gh search commits "<关键词>" --repo owner/repo --limit 5

# 蓝图 — 仓库全貌
node scripts/gh-repo-blueprint.js <owner/repo>

# 摘要 — Issue/PR 详情
node scripts/gh-digest.js issue <owner/repo> <number>
node scripts/gh-digest.js pr <owner/repo> <number>

# 探索 — 话题调研
node scripts/gh-explore.js "<关键词>"

# 版本对比
node scripts/gh-version-diff.js <owner/repo> <tag1> [tag2]

# REST API（高级）
gh api repos/{owner}/{repo}
```

## 脚本工具

| 脚本 | 用途 | 核心参数 |
|------|------|----------|
| `gh-repo-blueprint.js` | 仓库蓝图 | `<owner/repo> [output-dir]` |
| `gh-digest.js` | Issue/PR 摘要 | `<issue\|pr> <owner/repo> <number> [output-dir]` |
| `gh-explore.js` | 话题探索 | `"<keyword>" [--language X] [--output-dir dir]` |
| `gh-version-diff.js` | 版本对比 | `<owner/repo> <tag1> [tag2] [--output-dir dir]` |

默认输出目录：`~/docs/github-article/`

## 参考资料

| 文件 | 用途 | 何时阅读 |
|------|------|----------|
| `references/search-commands.md` | `gh` CLI 完整命令参考（50+ 示例） | 速查不够用时，或需要高级搜索语法 |
| `references/blueprint-format.md` | 蓝图撰写模板与分析指南 | 写蓝图时必读 |
| `references/output-spec.md` | 输出规范（命名、frontmatter、语言） | 生成文档前确认格式 |
