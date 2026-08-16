# gh search 完整命令参考

当 SKILL.md 中的快速示例不够用时，查阅此文件获取完整参数。

## 目录

1. [搜索仓库](#搜索仓库)
2. [搜索 Issues](#搜索-issues)
3. [搜索 PRs](#搜索-prs)
4. [搜索代码](#搜索代码)
5. [搜索 Commits](#搜索-commits)
6. [查看详情](#查看详情)
7. [GitHub API](#github-api)
8. [实用技巧](#实用技巧)

---

## 搜索仓库

```bash
gh search repos "<query>" [flags]
```

| Flag | 说明 | 示例 |
|------|------|------|
| `--sort` | 排序: stars, forks, updated, help-wanted-issues | `--sort stars` |
| `--order` | 排序方向: asc, desc | `--order desc` |
| `--language` | 按语言筛选 | `--language python` |
| `--stars` | Star 数范围 | `--stars ">1000"`, `--stars "100..500"` |
| `--created` | 创建时间 | `--created ">2024-01-01"` |
| `--pushed` | 最近推送时间 | `--pushed ">2024-06-01"` |
| `--topic` | 按 topic 筛选 | `--topic machine-learning` |
| `--license` | 按 license 筛选 | `--license mit` |
| `--archived` | 是否归档 | `--archived false` |
| `--limit` | 结果数量 (max 100) | `--limit 20` |
| `--json` | JSON 输出 + jq 处理 | `--json fullName,stargazersCount` |
| `--jq` | jq 表达式 | `--jq '.[].fullName'` |

**排除关键词**：用 `--` 分隔符

```bash
gh search repos --sort stars --limit 10 -- "react admin -antd"
```

**组合筛选**：

```bash
# 近期创建的高星 Python 项目
gh search repos "llm agent" --language python --stars ">500" --created ">2024-01-01" --sort stars --limit 10

# 活跃维护的 Go 项目
gh search repos "http router" --language go --pushed ">2024-06-01" --sort stars --limit 10
```

---

## 搜索 Issues

```bash
gh search issues "<query>" [flags]
```

| Flag | 说明 | 示例 |
|------|------|------|
| `--state` | open, closed | `--state closed` |
| `--repo` | 限定仓库 | `--repo owner/repo` |
| `--label` | 按标签筛选 (可多次使用) | `--label bug --label "help wanted"` |
| `--author` | 按作者 | `--author octocat` |
| `--assignee` | 按指派人 | `--assignee username` |
| `--sort` | 排序: created, updated, comments | `--sort comments` |
| `--created` | 创建时间 | `--created ">2024-01-01"` |
| `--updated` | 更新时间 | `--updated ">2024-06-01"` |
| `--limit` | 结果数量 | `--limit 20` |

**常用组合**：

```bash
# 搜已解决的 bug
gh search issues "memory leak" --state closed --label bug --limit 10

# 在特定仓库搜未解决的问题
gh search issues "crash on startup" --repo owner/repo --state open --sort updated --limit 5

# 搜需要帮助的 issue
gh search issues "good first issue" --label "good first issue" --state open --language python --limit 10
```

---

## 搜索 PRs

```bash
gh search prs "<query>" [flags]
```

| Flag | 说明 | 示例 |
|------|------|------|
| `--state` | open, closed | `--state closed` |
| `--merged` | 只返回已合并 PR | `--merged` |
| `--repo` | 限定仓库 | `--repo owner/repo` |
| `--label` | 按标签 | `--label enhancement` |
| `--author` | 按作者 | `--author username` |
| `--sort` | 排序: created, updated, comments | `--sort updated` |
| `--merged` | 合并时间 | `--merged ">2024-01-01"` |
| `--limit` | 结果数量 | `--limit 10` |

**常用组合**：

```bash
# 看某功能怎么实现的
gh search prs "add dark mode" --merged --sort updated --limit 5

# 看某仓库最近的 bug 修复
gh search prs "fix" --repo owner/repo --merged --label bug --limit 10
```

---

## 搜索代码

```bash
gh search code "<query>" [flags]
```

| Flag | 说明 | 示例 |
|------|------|------|
| `--repo` | 限定仓库 | `--repo owner/repo` |
| `--language` | 按语言 | `--language typescript` |
| `--extension` | 按文件扩展名 | `--extension yaml` |
| `--path` | 按文件路径 | `--path "src/"` |
| `--filename` | 按文件名 | `--filename "config"` |
| `--limit` | 结果数量 | `--limit 10` |

**常用组合**：

```bash
# 搜 API 调用方式
gh search code "createContext" --language typescript --limit 10

# 搜配置文件示例
gh search code "docker-compose" --path "deploy/" --extension yml --limit 10

# 在特定仓库搜
gh search code "authentication" --repo owner/repo --path "src/" --limit 10
```

---

## 搜索 Commits

```bash
gh search commits "<query>" [flags]
```

| Flag | 说明 | 示例 |
|------|------|------|
| `--repo` | 限定仓库 | `--repo owner/repo` |
| `--author` | 按作者 | `--author octocat` |
| `--committer` | 按提交者 | `--committer username` |
| `--author-date` | 作者日期 | `--author-date ">2024-01-01"` |
| `--sort` | 排序: author-date, committer-date | `--sort author-date` |
| `--limit` | 结果数量 | `--limit 10` |

---

## 查看详情

```bash
# 仓库概览（含 README）
gh repo view <owner/repo>

# 仓库 JSON 元数据
gh repo view <owner/repo> --json description,stargazersCount,forkCount,createdAt,pushedAt

# Issue 详情
gh issue view <number> --repo <owner/repo>
gh issue view <number> --repo <owner/repo> --json title,body,comments

# PR 详情
gh pr view <number> --repo <owner/repo>
gh pr view <number> --repo <owner/repo> --json title,body,files,additions,deletions,comments

# PR diff
gh pr diff <number> --repo <owner/repo>

# Release 列表
gh release list --repo <owner/repo> --limit 5
```

---

## GitHub API

当 search 命令无法满足需求时，直接调用 API。

### REST API

```bash
# 仓库详情
gh api repos/{owner}/{repo}

# Release 列表
gh api "repos/{owner}/{repo}/releases?per_page=5" --jq '.[].tag_name'

# 仓库语言分布
gh api repos/{owner}/{repo}/languages

# 贡献者
gh api "repos/{owner}/{repo}/contributors?per_page=10" --jq '.[] | "\(.login): \(.contributions)"'

# 仓库流量（需要 push 权限）
gh api repos/{owner}/{repo}/traffic/views

# 搜索 topics
gh api "search/topics?q=machine-learning" --jq '.items[].name'
```

### GraphQL API

```bash
# 仓库综合信息
gh api graphql -f query='
  query {
    repository(owner: "owner", name: "repo") {
      stargazerCount
      forkCount
      description
      primaryLanguage { name }
      issues(first: 5, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
        edges { node { title url number } }
      }
      pullRequests(first: 5, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
        edges { node { title url number mergedAt } }
      }
    }
  }
'

# 用户贡献统计
gh api graphql -f query='
  query {
    user(login: "username") {
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
      }
    }
  }
'
```

---

## 实用技巧

### JSON 输出 + jq 处理

所有 `gh` 命令都支持 `--json` + `--jq` 来结构化输出：

```bash
# 只输出仓库名和 star 数
gh search repos "keyword" --sort stars --limit 5 --json fullName,stargazersCount --jq '.[] | "\(.fullName): \(.stargazersCount)"'

# 输出为 TSV 方便后续处理
gh search repos "keyword" --json fullName,stargazersCount --jq '.[] | [.fullName, .stargazersCount] | @tsv'
```

### Rate Limit 管理

GitHub API 有速率限制。查看当前状态：

```bash
gh api rate_limit --jq '.resources.search'
```

搜索 API 限制：30 requests/min（认证用户）。如果遇到限流，等待 1 分钟后重试。

### 排除关键词

搜索时排除不想要的结果，用 `--` 分隔：

```bash
gh search repos --sort stars -- "react component -antd -material"
gh search issues --state closed -- "error -label:wontfix -label:duplicate"
```
