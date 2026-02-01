---
description: Analyze GitHub issues (bugs or feature requests)
---

# Issue 分析流程

你收到了一个 Issue: $ARGUMENTS

## 执行步骤

### 1. 读取 Issue

```bash
gh issue view <number> --json title,body,author,comments
```

### 2. 确定 Issue 类型

- **Bug**: 现有功能不工作
- **Feature**: 需要新功能
- **Question**: 使用问题
- **Documentation**: 文档问题

### 3. 根据类型分析

#### 如果是 Bug

1. **忽略** Issue 中的根因分析（通常不准确）
2. 读取相关代码文件（完整读取，不要截断）
3. 追踪代码路径，找到真正的根因
4. 提出修复方案

输出格式：
```markdown
## Issue: <url>

### Type
Bug

### Root Cause
[真正的根因，基于代码分析]

### Affected Files
- `path/to/file.ts:123` - [说明]

### Proposed Fix
[修复方案]

### Test Plan
- [ ] [如何测试修复]
```

#### 如果是 Feature

1. 读取相关代码文件
2. 评估实现复杂度
3. 提出最简洁的实现方案

输出格式：
```markdown
## Issue: <url>

### Type
Feature

### Summary
[功能描述]

### Implementation Approach
[实现方案]

### Affected Files
- `path/to/file.ts` - [需要改什么]

### Considerations
- [需要注意的点]
```

## 注意事项

- **只分析，不实现**（除非明确要求实现）
- 读取代码要完整，不要截断
- 如果需要更多信息，列出问题
