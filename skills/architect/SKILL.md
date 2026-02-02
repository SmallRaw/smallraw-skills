---
name: architect
description: AI 开发架构师 - 帮助建立和维护项目规范，规则是长出来的，不是设计出来的
license: MIT
compatibility: claude-code, opencode
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: false
---

# /architect - AI 开发架构师 Skill

> 核心理念：**规范是长出来的，不是设计出来的。**

---

## 能力概述

### 1. 问题识别

当用户描述问题时，识别这是否是"应该引入规则"的信号。

**信号词检测：**
- "又..."、"总是..."、"每次都..." → 重复问题，需要规则
- "不小心..."、"忘了..."、"漏了..." → 流程问题，需要自动化
- "冲突了..."、"覆盖了..."、"丢了..." → 协作问题，需要隔离规则
- "不知道..."、"找不到..." → 知识问题，需要文档

### 2. 规则推荐

根据问题类型，从知识库中推荐合适的规则。

查阅 `knowledge/problem-rule-map.md` 获取完整的问题-规则映射表。

### 3. 规则植入

将规则添加到项目的 `AGENTS.md` 对应章节。

规则格式参考 `knowledge/rule-templates.md`。

### 4. 规则回顾

定期检查规则健康度：
- 哪些规则被频繁触发？→ 可能需要加强或自动化
- 哪些规则从未触发？→ 可能可以移除
- 有没有新的重复问题？→ 可能需要新规则

### 5. 偏好检测（会话内）

在当前会话中检测用户的重复指令，识别可能的偏好规则。

**检测逻辑：**
- 第 1 次：正常执行
- 第 2 次：记住但不打扰
- 第 3 次：主动询问

**询问模板：**
> "我注意到你在这个会话中多次提到 [具体指令]，要把它加入 AGENTS.md 作为偏好规则吗？"

**偏好规则 vs 守护规则：**

| 类型 | 来源 | 例子 |
|------|------|------|
| 守护规则 | 从错误中学习 | "不要 git stash" |
| 偏好规则 | 从重复中提取 | "测试 Web 用 MCP" |

**偏好规则写法：**
```markdown
## 用户偏好

- 测试 Web 端：优先使用 MCP (chrome-devtools)
- 测试 iOS 端：优先使用真机，其次模拟器
- 提交代码：使用 scripts/committer
```

**注意：** 会话隔离 = 上下文隔离。切换会话后重新计数，不跨会话检测。

---

## 使用方式

### 初始化新项目

```
/architect init
```

创建：
- `AGENTS.md` - 包含 10 条核心规则的起始模板
- `scripts/committer` - 安全提交脚本

从 `starter/AGENTS.starter.md` 和 `starter/committer` 复制。

### 遇到问题时

```
/architect problem "我又把 .env 文件提交了"
```

1. 识别这是"安全规则"类问题
2. 查阅 `knowledge/problem-rule-map.md` 找到规则 S3
3. 推荐添加规则到 AGENTS.md
4. 更新 Rules Evolution 表

### 扩展规则

```
/architect extend quality    # 添加质量规则（测试、代码风格）
/architect extend workflow   # 添加流程规则（PR、发布）
/architect extend collab     # 添加协作规则（多 Agent）
```

从 `growth/level-*.md` 文件获取规则扩展包。

### 回顾规则

```
/architect review
```

检查当前 AGENTS.md 的规则健康度。

---

## 规则优先级金字塔

```
           ┌─────────────────┐
     Level │   协作规则      │  ← 多人/多 Agent 时加
       3   │ Multi-agent     │
           ├─────────────────┤
     Level │   流程规则      │  ← 有 PR/发布流程时加
       2   │ PR、Changelog   │
           ├─────────────────┤
     Level │   质量规则      │  ← 代码质量问题时加
       1   │ 测试、Lint      │
           ├─────────────────┤
     Level │   安全规则      │  ← 第一天就加
       0   │ 禁止危险操作    │
           └─────────────────┘
```

---

## 规则引入时机

**守护规则（从错误学习）：**
```
问题第 1 次 → 记录到每日笔记
问题第 2 次 → 评估：
              ├── 破坏性操作？ → 立即加规则
              ├── 多人协作？   → 立即加规则
              └── 效率问题？   → 可以再观察
问题第 3 次 → 必须加规则
```

**偏好规则（从重复提取）：**
```
指令第 1 次 → 正常执行
指令第 2 次 → 标记（可能是偏好）
指令第 3 次 → 主动询问："要加入 AGENTS.md 吗？"
```

---

## 知识库文件

| 文件 | 用途 |
|------|------|
| `knowledge/problem-rule-map.md` | 问题-规则映射表（54 条规则，8 个类别） |
| `knowledge/rule-templates.md` | 7 种规则模板写法 |
| `starter/AGENTS.starter.md` | 起始模板（10 条核心规则） |
| `starter/committer` | 安全提交脚本 |
| `starter/.gitignore.template` | Git 忽略模板 |
| `growth/level-1-quality.md` | 质量规则扩展包 |
| `growth/level-2-workflow.md` | 流程规则扩展包 |
| `growth/level-3-collab.md` | 协作规则扩展包 |
| `global-rules/core.md` | 全局核心规则模板 |
| `global-rules/multi-agent.md` | 多 Agent 协作规则模板 |
| `prompts/pr.md` | PR 审查 SOP |
| `prompts/issue.md` | Issue 分析 SOP |
| `prompts/changelog.md` | Changelog 更新 SOP |

---

## 核心原则

1. **从简单开始**：初始只有 10 条规则
2. **按需生长**：遇到问题再加规则
3. **定期回顾**：删除无用规则，强化有用规则
4. **可解释**：每条规则都要说明"为什么"
5. **可自动化**：能自动化的规则，就用脚本/hook 实现

---

## 来源

这个 Skill 的知识库来自对 [OpenClaw](https://github.com/openclaw/openclaw) 项目的分析。该项目由 AI 主导开发，积累了 7000+ 次提交，AGENTS.md 从 2 行增长到 179 行，形成了成熟的规范体系。
