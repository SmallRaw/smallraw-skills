---
description: Review PRs with structured analysis
---

# PR 审查流程

你收到了一个 PR 链接: $ARGUMENTS

## 执行步骤

### 1. 读取 PR 信息

```bash
gh pr view <number> --json title,body,author,commits,comments
gh pr diff <number>
```

### 2. 读取关联内容

- 找到 PR 描述中引用的 Issue
- 读取相关代码文件（完整读取，不要截断）
- 检查是否有相关测试

### 3. 分析 PR

对照代码变更，检查：
- 逻辑是否正确
- 是否有遗漏的边界情况
- 是否需要更新文档
- 是否需要更新测试

### 4. 输出审查结果

使用以下格式：

```markdown
## PR: <url>

### Good
- [优点 1]
- [优点 2]

### Bad
- [问题 1]
- [问题 2]

### Ugly（严重问题）
- [严重问题，如果有]

### Questions
- [不确定的地方]

### Summary
[一句话总结这个 PR 做了什么]

### Tests
- [ ] 测试是否充分
- [ ] 是否需要添加测试
```

## 注意事项

- **Review 模式**：只读取，不修改代码，不切换分支
- 如果没有问题，在 Bad 和 Ugly 下写 "None"
- 忽略 PR 描述中的根因分析（可能不准确），自己分析代码
