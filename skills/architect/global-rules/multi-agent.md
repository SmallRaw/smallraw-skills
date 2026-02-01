# 多 Agent 协作规则

> 当多个 AI Agent 同时工作时必须遵守的规则。
> 安装位置: ~/.claude/rules/multi-agent.md

---

## 核心原则

**假设随时可能有其他 Agent 在工作。**

你看不到其他 Agent，但他们可能正在：
- 编辑文件
- 暂存改动
- 准备提交

因此，所有操作都要考虑对其他 Agent 的影响。

---

## Git 操作限制

- **MUST** 禁止 `git stash`（除非用户明确要求）
  为什么：多个 Agent 的 stash 会互相覆盖。
  包括：`git stash`, `git stash pop`, `git pull --rebase --autostash`
  正确做法：先提交当前工作，或询问用户。

- **MUST** 禁止切换分支（除非用户明确要求）
  为什么：会影响其他 Agent 的工作上下文。
  正确做法：在当前分支工作，或请求用户允许。

- **MUST** 禁止修改 git worktree（除非用户明确要求）
  为什么：worktree 是共享资源。
  包括：创建、删除、修改 worktree。

---

## 提交行为

- **MUST** commit 只包含自己明确修改的文件
  为什么：其他 Agent 可能有未完成的工作。
  正确做法：使用 `scripts/committer "<msg>" file1 file2`

- **SHOULD** 看到不认识的文件时，忽略它
  为什么：可能是其他 Agent 正在工作。
  正确做法：专注自己的任务，不要问"要不要处理这个文件"。

- **SHOULD** 报告只关注自己的改动
  为什么：避免报告太长太杂。
  正确做法：描述自己做了什么，不描述看到了什么。

---

## 同步行为

- **MAY** push 前可以 `git pull --rebase`
  为什么：需要同步远程的新提交。
  但是：不能丢弃别人的工作。

- **MUST** 遇到冲突时，保守处理
  为什么：不确定其他 Agent 的意图。
  正确做法：停下来询问用户，不要自动解决。

---

## Session 隔离

- **MUST** 每个 Agent 使用独立的 session
  为什么：共享 session 会导致上下文混乱。

- **SHOULD** 不要假设其他 Agent 的状态
  为什么：你不知道他们做了什么。

- **SHOULD** 不要依赖全局状态
  为什么：可能被其他 Agent 修改。

---

## 通信模式

- **SHOULD** 完成任务后简要报告
  格式：做了什么 + 改了哪些文件

- **SHOULD NOT** 报告"看到了什么"
  为什么：那可能是其他 Agent 的工作。

- **SHOULD** 如果其他文件有相关性，简单提一下
  格式：结尾加一句"注意：XXX 文件有相关改动"
