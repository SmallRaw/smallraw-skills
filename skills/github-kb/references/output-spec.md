# 输出规范

## 何时保存

默认直接在当前任务中回答，不强制落盘。只有以下情况才写入 `~/docs/github-article/`：

- 用户明确要求保存、归档或生成知识库文章；
- 当前任务本身就是维护 GitHub KB。

运行采集脚本时可以传入显式输出目录；评测、冒烟和临时产物必须写入当前仓库的 `workspaces/github-kb/`，不能污染正式知识库。

## 文件命名

| 类型 | 命名 | 示例 |
|------|------|------|
| 蓝图 | `<repo-safe>-blueprint.md` | `facebook-react-a1b2c3d4-blueprint.md` |
| Issue 摘要 | `<repo-safe>-issue-<N>.md` | `vercel-next.js-a1b2c3d4-issue-12345.md` |
| PR 摘要 | `<repo-safe>-pr-<N>.md` | `vercel-next.js-a1b2c3d4-pr-5678.md` |
| 探索报告 | `explore-<keyword-safe>.md` | `explore-mcp-server-a1b2c3d4.md` |
| 版本对比 | `<repo-safe>-version-diff-<base-safe>-<head-safe>.md` | `facebook-react-a1b2c3d4-version-diff-v18.3.0-e5f6a7b8-v18.3.1-c9d0e1f2.md` |

`*-safe` 由脚本生成：保留可读前缀，并追加输入内容的稳定短哈希。不要只做 ASCII 转换，否则中文关键词可能全部退化为同一个文件名并互相覆盖。

## 语言要求

所有输出文档使用**中文**撰写。脚本采集的原始数据（英文 README、Issue 正文等）保留原文放在折叠区域，但架构分析、总结、关键发现等 AI 撰写的内容一律用中文。

## YAML Frontmatter

落盘文档必须包含 frontmatter。源码研究还要记录访问时使用的 ref 与解析后的 commit SHA：

```yaml
---
repo: owner/repo          # 或 keyword（探索模式）
generated: 2024-01-01
type: blueprint | digest | exploration | version-diff | implementation-study | comparison
source_ref: main          # 不适用时省略
resolved_sha: abcdef...   # 不适用时省略；源码结论应尽量固定到 SHA
---
```

不同类型可能包含额外字段。例如 version-diff 应记录 `base`、`head`、`base_sha`、`head_sha`、`total_commits`。动态指标（Stars、Issue 状态等）要在正文或 frontmatter 标注采集日期，避免把会变化的数据写成永恒事实。
