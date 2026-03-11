# Level 1: 质量规则扩展包

> 当项目开始关注代码质量时，添加这些规则。
> 触发信号：CI 经常失败、代码 review 发现问题、测试覆盖率低

---

## 添加到 AGENTS.md 的规则

### Testing 章节

```markdown
## Testing

- **测试框架:** [填写你的测试框架]
- **覆盖率阈值:** [建议 70%+]

- 推送前运行测试：`pnpm test`
- 修改逻辑代码后必须确保测试通过。
- 测试文件命名：`*.test.ts` 或 `*.spec.ts`
- E2E 测试命名：`*.e2e.test.ts`

- **测试原则:**
  - 新功能必须有测试
  - Bug 修复必须有回归测试
  - 纯测试改动不需要 changelog
```

### Code Style 章节

```markdown
## Code Style

- **语言:** TypeScript (ESM)，严格模式
- **格式化:** [填写你的工具，如 Prettier, Biome, oxfmt]
- **Lint:** [填写你的工具，如 ESLint, Biome, oxlint]

- 提交前运行 lint：`pnpm lint`
- 文件不超过 500 行。超过时考虑拆分。
- 避免使用 `any`，使用 `unknown` 或具体类型。
- 复杂逻辑添加简短注释说明"为什么"。
- 提取重复代码为函数，不要复制粘贴。
```

### Pre-commit Hooks 章节

```markdown
## Pre-commit Hooks

建议配置：

\`\`\`yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: lint
        name: lint
        entry: pnpm lint
        language: system
        pass_filenames: false
      - id: test
        name: test
        entry: pnpm test
        language: system
        pass_filenames: false
\`\`\`

安装：`pnpm add -D husky` 或使用 pre-commit 框架
```

---

## 配套工具

### .editorconfig

```ini
# .editorconfig
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### TypeScript 严格配置

```json
// tsconfig.json 关键配置
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

---

## 检查清单

添加这个扩展包后，确认：

- [ ] 测试框架已配置
- [ ] Lint 工具已配置
- [ ] 格式化工具已配置
- [ ] Pre-commit hooks 已安装
- [ ] CI 中有测试和 lint 步骤
- [ ] 覆盖率阈值已设置
