# Repository Guidelines

> 这是项目的 AI 开发规范。规则会随着项目成长逐步添加。
> 原则：从简单开始，遇到问题再加规则。

---

## Project Structure

<!-- 根据你的项目填写 -->

```
src/           # 源代码
tests/         # 测试文件
docs/          # 文档
scripts/       # 脚本工具
```

---

## Build & Dev Commands

<!-- 根据你的项目填写 -->

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 测试
pnpm test

# Lint
pnpm lint
```

---

## Git Safety

> 这些规则继承自全局规则，在此重申以强调重要性。

- **MUST** 禁止使用 `git add .` 或 `git add -A`
  正确做法：使用 `scripts/committer` 或明确指定文件。

- **MUST** 禁止编辑 `node_modules`
  正确做法：使用 patch-package 或 fork。

- **MUST** 禁止提交敏感信息（API keys, 密码, tokens）
  正确做法：使用 placeholder，检查 .gitignore。

---

## Commit Guidelines

- 使用 `scripts/committer "<msg>" <files...>` 提交代码。

- 提交信息格式：`type(scope): description`
  ```
  feat(auth): add login API
  fix(ui): correct button alignment
  docs: update README
  chore: update dependencies
  ```

- type 类型：
  - `feat`: 新功能
  - `fix`: Bug 修复
  - `docs`: 文档
  - `style`: 格式（不影响代码运行）
  - `refactor`: 重构
  - `test`: 测试
  - `chore`: 杂项

---

## Testing

- **MUST** 推送前运行测试：`pnpm test`
- 修改逻辑代码后必须确保测试通过。
- 纯测试改动不需要 changelog。

---

## Code Style

- **SHOULD** 文件不超过 500 行。超过时考虑拆分。
- **SHOULD** 复杂逻辑添加简短注释。
- **MUST** 避免使用 `any`（TypeScript 项目）。

---

## Multi-agent Safety

> 如果多个 AI Agent 同时工作，必须遵循以下规则。

- **MUST** 禁止 git stash（除非用户明确要求）
- **MUST** 禁止切换分支（除非用户明确要求）
- **MUST** commit 时只提交自己明确修改的文件
- **SHOULD** 看到不认识的文件时，忽略它，专注自己的任务

---

## Agent Notes

<!-- 项目特定的 Agent 注意事项，随着项目发展逐步添加 -->

- 回答问题时，先验证代码再回答，不要猜测。

---

## Rules Evolution

> 记录规则的演进历史，帮助理解为什么有这些规则。

| 日期 | 规则 | 起因 | 类型 |
|------|------|------|------|
| YYYY-MM-DD | 初始化项目规范 | 项目创建 | - |

<!--
添加新规则时，在这里记录：

| 2026-02-03 | 禁止 git stash | Agent A 和 B 的 stash 互相覆盖 | 安全 |
| 2026-02-05 | 使用 committer | 多次提交了 .env 文件 | 安全 |
| 2026-02-10 | 文件 < 500 行 | foo.ts 超过 1000 行难以维护 | 质量 |
-->
