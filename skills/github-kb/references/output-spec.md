# 输出规范

## 保存位置

所有生成的文档保存到 `~/docs/github-article/`。

## 文件命名

| 类型 | 命名 | 示例 |
|------|------|------|
| 蓝图 | `<owner>-<repo>-blueprint.md` | `facebook-react-blueprint.md` |
| Issue 摘要 | `<owner>-<repo>-issue-<N>.md` | `vercel-next.js-issue-12345.md` |
| PR 摘要 | `<owner>-<repo>-pr-<N>.md` | `vercel-next.js-pr-5678.md` |
| 探索报告 | `explore-<keyword>.md` | `explore-mcp-server.md` |
| 版本对比 | `<owner>-<repo>-version-diff-<base>-<head>.md` | `facebook-react-version-diff-v18.3.0-v18.3.1.md` |

## 语言要求

所有输出文档使用**中文**撰写。脚本采集的原始数据（英文 README、Issue 正文等）保留原文放在折叠区域，但架构分析、总结、关键发现等 AI 撰写的内容一律用中文。

## YAML Frontmatter

每个文档必须包含 frontmatter：

```yaml
---
repo: owner/repo          # 或 keyword（探索模式）
generated: 2024-01-01
type: blueprint | digest | exploration | version-diff
---
```

不同类型可能包含额外字段（如 version-diff 的 `base`、`head`、`total_commits`）。
