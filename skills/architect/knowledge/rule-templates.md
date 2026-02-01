# 规则模板库

> 添加规则时，使用这些标准模板保持一致性。

---

## 模板 A：禁止型规则

用于禁止某种危险/不当行为。

```markdown
- **[类别]:** 禁止 [行为]（除非 [例外条件]）。
  [为什么：一句话解释原因]
```

**示例：**

```markdown
- **Git 安全:** 禁止使用 `git add .` 和 `git add -A`（除非明确列出所有文件）。
  为什么：可能会意外提交敏感文件或大文件。

- **Multi-agent:** 禁止 git stash（除非用户明确要求）。
  为什么：其他 Agent 可能也在工作，stash 会互相覆盖。

- **依赖管理:** 禁止编辑 node_modules。
  为什么：下次 npm install 会覆盖你的改动。
```

---

## 模板 B：流程型规则

用于定义标准操作流程。

```markdown
- **[场景]流程:** [步骤 1] → [步骤 2] → [步骤 3]
```

**示例：**

```markdown
- **PR 合并流程:** 创建临时分支 → 合并 PR → 运行 gate → 添加 changelog → 合回 main → 删除临时分支

- **提交流程:** 运行测试 → 使用 committer 提交 → 推送

- **发布流程:** 更新版本号 → 更新 changelog → 运行完整 gate → 创建 tag → 发布
```

---

## 模板 C：工具型规则

用于指定使用什么工具/命令。

```markdown
- **[场景]:** 使用 [正确工具]，不要 [错误做法]。
  位置：`[工具路径]`
```

**示例：**

```markdown
- **提交代码:** 使用 `scripts/committer "<msg>" <files...>`，不要手动 git add/commit。
  位置：`scripts/committer`

- **进度显示:** 使用 `src/cli/progress.ts`，不要自己写 spinner。
  位置：`src/cli/progress.ts`

- **查看日志:** 使用 `scripts/clawlog.sh`，不要直接 grep 日志文件。
  位置：`scripts/clawlog.sh`
```

---

## 模板 D：位置型规则

用于说明资源/文件的位置。

```markdown
- **[资源名称]位置:**
  - [平台/场景 1]: `[路径 1]`
  - [平台/场景 2]: `[路径 2]`
```

**示例：**

```markdown
- **版本号位置:**
  - CLI: `package.json` (version)
  - Android: `apps/android/app/build.gradle.kts` (versionName)
  - iOS: `apps/ios/Sources/Info.plist` (CFBundleShortVersionString)
  - macOS: `apps/macos/Sources/Info.plist` (CFBundleShortVersionString)

- **配置文件位置:**
  - 用户配置: `~/.appname/config.json`
  - 项目配置: `.appname.json`
  - 环境变量: `.env`
```

---

## 模板 E：模式型规则

用于定义工作模式的区别。

```markdown
- **[模式名称]模式:** [描述]
  - 可以：[允许的操作]
  - 不可以：[禁止的操作]
```

**示例：**

```markdown
- **Review 模式:** 只读审查 PR
  - 可以：gh pr view, gh pr diff, 读取文件
  - 不可以：切换分支, 修改代码, 提交

- **Land 模式:** 合并 PR 到 main
  - 可以：创建临时分支, 合并, 提交, 删除分支
  - 不可以：直接在 main 上提交
```

---

## 模板 F：条件型规则

用于定义在特定条件下的行为。

```markdown
- **当 [条件] 时:** [行为]
```

**示例：**

```markdown
- **当看到不认识的文件时:** 忽略它，专注自己的任务。

- **当 lint/format 改动时:** 自动处理，不需要确认。

- **当 push 前远程有新提交时:** 可以 git pull --rebase，但不能丢弃别人的工作。

- **当问题第 2 次出现时:** 考虑是否需要添加规则。

- **当问题涉及破坏性操作时:** 立即添加规则，不等第 3 次。
```

---

## 模板 G：检查清单型规则

用于定义需要检查的事项。

```markdown
- **[操作]前检查:**
  - [ ] [检查项 1]
  - [ ] [检查项 2]
  - [ ] [检查项 3]
```

**示例：**

```markdown
- **推送前检查:**
  - [ ] 测试通过 (`pnpm test`)
  - [ ] Lint 通过 (`pnpm lint`)
  - [ ] 构建成功 (`pnpm build`)

- **发布前检查:**
  - [ ] 版本号已更新
  - [ ] Changelog 已更新
  - [ ] 完整 gate 通过
  - [ ] 获得发布批准

- **添加新 channel 前检查:**
  - [ ] 文档已添加
  - [ ] 配置 schema 已更新
  - [ ] labeler.yml 已更新
  - [ ] 所有 UI 表面已更新
```

---

## 章节模板

AGENTS.md 的标准章节结构：

```markdown
# Repository Guidelines

## Project Structure
[目录结构说明]

## Build & Dev Commands
[构建和开发命令]

## Coding Style
[代码风格规范]

## Testing
[测试规范]

## Commit & PR
[提交和 PR 规范]

## Security
[安全相关规则]

## Agent Notes
[AI Agent 特定规则]

## Multi-agent Safety
[多 Agent 协作规则]

## Tools & Shortcuts
[项目特定工具和快捷方式]
```
