---
name: rule-gardener
description: 用户说 "加个规则"、遇到重复问题想固化经验、或初始化新项目规范时触发。
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

| 命令 | 用途 |
|------|------|
| `init` | 初始化项目规范（AGENTS.md + committer 脚本） |
| `problem "描述"` | 分析问题，从 54 条规则中推荐并植入 |
| `extend quality\|workflow\|collab` | 添加规则扩展包 |
| `review` | 回顾规则健康度，清理无用规则 |
| `analyze [--recent N\|--all]` | 跨会话分析，发现长期模式 |

执行任何命令前，先读取对应的知识库文件获取完整方法论。

## 核心规则

1. **两次出现才加规则** — 问题第 1 次只记录；第 2 次评估是否加规则；第 3 次必须加。但破坏性问题（数据丢失、安全泄露）或协作冲突第 1 次就加。
2. **先查后加** — 植入新规则前，必须先读 `knowledge/problem-rule-map.md` 确认是否已有对应规则（54 条、8 类），避免重复造规则。
3. **规则按 Level 生长** — Level 0 安全规则第一天就加；Level 1 质量规则等代码质量出问题再加；Level 2 流程规则等有 PR/发布时加；Level 3 协作规则等多 Agent 时加。不要提前引入高级别规则。
4. **只写偏离默认行为的指令** — 规则必须推动模型做出不同于默认行为的事。"写好代码"不是规则，"文件不超过 500 行"才是。
5. **规则要可执行** — 每条规则必须可验证（能回答"违反了吗？"），模糊的"注意 XX"不是规则。用 `knowledge/rule-templates.md` 中的 7 种模板保持写法一致。
6. **全局规则不可覆盖** — `~/.claude/rules/` 中的 MUST 规则是宪法级别，项目 AGENTS.md 只能扩展（更严格），不能削弱。

## Gotchas

1. **过早加规则是最常见的错误** — 问题只出现 1 次就加规则，会导致 AGENTS.md 膨胀为无人阅读的废纸。坚守"两次出现"门槛。
2. **不要从零发明规则** — `problem-rule-map.md` 覆盖了 54 条从真实项目（7000+ commits）提炼的规则，直接查表比自己编更靠谱。
3. **init 不等于加满规则** — `init` 只植入 10 条核心安全规则（starter/AGENTS.starter.md），不要在初始化时就塞入 quality/workflow/collab 包。
4. **review 时要敢删规则** — 超过 30 天未触发的规则很可能是噪音。规则园丁不只种树，也要剪枝。
5. **analyze 只分析模式，不直接改 AGENTS.md** — 跨会话分析产出的是规则建议报告，必须经用户确认才能植入，不能静默修改。
6. **extend 包是菜单不是套餐** — `extend quality` 不是把整个 level-1-quality.md 复制进去，而是根据项目实际情况挑选需要的条目。
7. **规则演进表容易被遗忘** — 每次植入/删除规则后，必须同步更新 AGENTS.md 底部的 Rules Evolution 表，否则规则来源不可追溯。

## 参考文件索引

详细内容按需加载，不要一次性全部读取：

| 目录 | 内容 |
|------|------|
| `knowledge/` | 问题-规则映射(54 条)、规则模板(7 种)、会话分析方法论、多 Provider 路径参考 |
| `growth/` | 三个扩展包：quality / workflow / collab |
| `starter/` | init 模板：AGENTS.starter.md(10 条核心规则) + committer 脚本 + .gitignore |
| `prompts/` | PR 审查 / Issue 分析 / Changelog 更新的 SOP |
| `global-rules/` | 全局核心规则 + 多 Agent 规则模板 |
