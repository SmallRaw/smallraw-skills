# Level 2: 流程规则扩展包

> 当项目有 PR 流程、发布流程时，添加这些规则。
> 触发信号：有多个贡献者、需要 code review、有版本发布

---

## 添加到 AGENTS.md 的规则

### PR Workflow 章节

```markdown
## PR Workflow

### Review 模式（只审查，不修改）

当收到 PR 链接进行审查时：
- 可以：`gh pr view`, `gh pr diff`, 读取文件
- 不可以：切换分支, 修改代码, 提交
- 不要：切换到 PR 分支

### Land 模式（合并 PR）

合并 PR 的标准流程：
1. 创建临时分支：`git checkout -b temp-merge main`
2. 合并 PR：`gh pr checkout <number>` 或 `git merge`
3. 修复问题（如有）
4. 运行完整 gate：`pnpm lint && pnpm build && pnpm test`
5. 添加 changelog 条目（包含 PR 号和感谢）
6. 提交
7. 合回 main：`git checkout main && git merge temp-merge`
8. 删除临时分支：`git branch -d temp-merge`
9. 推送

### PR 合并策略

- **rebase:** 当 PR commits 干净清晰时
- **squash:** 当 PR commits 混乱或太多时
- squash 时添加原作者为 co-author

### Changelog 格式

\`\`\`markdown
## [版本号]

### Changes
- 功能描述 (#PR号) Thanks @contributor

### Fixes
- 修复描述 (#PR号) Thanks @contributor
\`\`\`
```

### Release 章节

```markdown
## Release

### 版本号位置

更新版本时，检查以下位置：
- `package.json` (version)
- [其他位置根据项目填写]

### 发布前检查

- [ ] 版本号已更新（所有位置）
- [ ] Changelog 已更新
- [ ] 完整 gate 通过
- [ ] 获得发布批准

### 发布流程

1. 更新版本号
2. 更新 changelog
3. 运行完整 gate
4. 创建 git tag
5. 推送 tag
6. 发布（npm publish / GitHub release）
7. 验证发布成功

### Release Guardrails

- 不要未经批准修改版本号
- 不要未经批准执行发布命令
- 发布前必须明确确认
```

---

## 配套工具

### Changelog 模板

```markdown
# Changelog

## [Unreleased]
<!-- 或者直接用版本号，不用 Unreleased -->

## [1.0.0] - YYYY-MM-DD

### Added
- 新功能

### Changed
- 变更

### Fixed
- 修复

### Removed
- 移除
```

### PR 模板

```markdown
<!-- .github/pull_request_template.md -->

## Summary
<!-- 简要描述这个 PR 做了什么 -->

## Changes
-
-

## Test Plan
- [ ] 测试通过
- [ ]

## Checklist
- [ ] 代码已自测
- [ ] 文档已更新（如需要）
- [ ] Changelog 已更新
```

---

## 检查清单

添加这个扩展包后，确认：

- [ ] PR 模板已创建
- [ ] Changelog 模板已创建
- [ ] 版本号位置已记录
- [ ] 发布流程已文档化
- [ ] CI 中有 PR 检查
