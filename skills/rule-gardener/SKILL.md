---
name: rule-gardener
description: 项目规则园丁 - 从问题和重复指令中发现、推荐、植入 AGENTS.md 规则，培育项目规范有机生长。使用 /rule-gardener init 初始化项目规范，/rule-gardener problem 分析问题并推荐规则，/rule-gardener analyze 跨会话分析模式，/rule-gardener review 回顾规则健康度，/rule-gardener extend 扩展规则包。适合定期执行（如每天一次 analyze）来发现长期模式。
license: MIT
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: true
---

# /rule-gardener - 项目规则园丁

> 核心理念：**规范是长出来的，不是设计出来的。**

## 命令

| 命令 | 用途 | 知识库 |
|------|------|--------|
| `/rule-gardener init` | 初始化项目规范（AGENTS.md + committer 脚本） | `starter/` |
| `/rule-gardener problem "描述"` | 分析问题，从 54 条规则中推荐并植入 | `knowledge/problem-rule-map.md` |
| `/rule-gardener extend quality\|workflow\|collab` | 添加规则扩展包 | `growth/level-*.md` |
| `/rule-gardener review` | 回顾规则健康度，清理无用规则 | `knowledge/rule-templates.md` |
| `/rule-gardener analyze [--recent N\|--all]` | 跨会话分析，发现长期模式 | `knowledge/session-analysis.md` |

执行任何命令前，先读取对应的知识库文件获取完整方法论。

## 规则优先级

```
Level 0: 安全规则（禁止危险操作）← 第一天就加
Level 1: 质量规则（测试、Lint）← 代码质量问题时加
Level 2: 流程规则（PR、Changelog）← 有发布流程时加
Level 3: 协作规则（多 Agent）← 多人协作时加
```

## 知识库（按需加载）

| 文件 | 何时读取 |
|------|----------|
| `knowledge/problem-rule-map.md` | problem 命令：查问题-规则映射（54 条规则，8 类） |
| `knowledge/rule-templates.md` | 植入规则时：查 7 种规则模板写法 |
| `knowledge/session-analysis.md` | analyze 命令：跨会话分析方法论 |
| `knowledge/cc-switch-providers-reference.md` | analyze 命令：多 Provider 会话路径 |
| `starter/AGENTS.starter.md` | init 命令：起始模板（10 条核心规则） |
| `starter/committer` | init 命令：安全提交脚本 |
| `starter/.gitignore.template` | init 命令：Git 忽略模板 |
| `growth/level-1-quality.md` | extend quality：质量规则包 |
| `growth/level-2-workflow.md` | extend workflow：流程规则包 |
| `growth/level-3-collab.md` | extend collab：协作规则包 |
| `global-rules/core.md` | init 命令：全局核心规则 |
| `global-rules/multi-agent.md` | extend collab：多 Agent 规则 |
| `prompts/pr.md` | PR 审查 SOP |
| `prompts/issue.md` | Issue 分析 SOP |
| `prompts/changelog.md` | Changelog 更新 SOP |
