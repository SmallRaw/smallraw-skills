---
description: Add changelog entry for merged PR
---

# Changelog 更新流程

为合并的 PR 添加 changelog 条目。

## 执行步骤

### 1. 获取 PR 信息

```bash
gh pr view <number> --json title,body,author,mergedBy
```

### 2. 确定变更类型

| 类型 | 描述 | 示例 |
|------|------|------|
| **Added** | 新功能 | 添加了 XX 功能 |
| **Changed** | 现有功能变更 | 更新了 XX 行为 |
| **Fixed** | Bug 修复 | 修复了 XX 问题 |
| **Removed** | 移除功能 | 移除了 XX |
| **Security** | 安全修复 | 修复 XX 漏洞 |
| **Deprecated** | 废弃警告 | XX 将在下版本移除 |

### 3. 编写条目

格式：
```markdown
- [描述] (#PR号) Thanks @contributor
```

示例：
```markdown
- Discord: add PluralKit sender identity resolver (#5838) Thanks @thewilloftheshadow
- fix: resolve Windows npm spawn ENOENT (#5815) Thanks @thejhinvirtuoso
```

### 4. 添加到 CHANGELOG.md

找到当前版本的对应章节，添加条目。

```markdown
## [当前版本]

### Added
- ...

### Fixed
- [你的条目]
```

## 格式规范

- 条目以动词开头（Add, Fix, Update, Remove）
- 包含 PR 号：`(#123)`
- 感谢贡献者：`Thanks @username`
- 如果是安全修复，包含 CVE/GHSA 编号

## 不需要 Changelog 的情况

- 纯测试改动（不影响用户）
- 纯文档改动（除非是重要的用户文档）
- 内部重构（不改变行为）
