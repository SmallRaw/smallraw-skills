---
name: fractal-docs
description: 当用户请求初始化、更新或检查项目的分形文档体系（三行头注释 + 目录 AGENTS.md + 级联规则）时触发
license: MIT
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: true
---

# /fractal-docs - 分形文档协议维护工具

本 skill 是分形文档协议的**维护工具**。协议本身定义在项目的 `FRACTAL-DOCS.md` 中，Agent 读项目时直接按协议导航即可。

## Companion CLI

`fractal-context` 是只读上下文导航 CLI，用来消费已有分形文档，不负责创建、更新或修复文档。需要让 agent 先按文档理解代码时使用它：

```bash
fractal-context status
fractal-context list src --depth 2
fractal-context read src/wallet.ts
fractal-context search wallet
```

仓库内开发或未发布到 npm 时，用本地构建：

```bash
cd packages/fractal-context-cli
npm install
npm run build
node dist/index.js status --root /path/to/project
```

发布到 npm 后才可使用：

```bash
npx fractal-context-cli status --root /path/to/project
```

是否发布：如果只在本仓库或本机使用，不需要发布；如果希望 Codex、Claude Code、Pi worker 或其他机器直接 `npx fractal-context-cli` 调用，就需要发布 npm 包。

## 核心规则

1. **先读 SOP 再动手** -- 每个命令有独立 SOP（`prompts/*.md`），执行前必须读完对应 SOP，不要凭记忆操作
2. **协议与工具分离** -- 协议定义在项目根 `FRACTAL-DOCS.md`，本 skill 只做创建/维护，不要把协议内容写进 SKILL.md 或 AGENTS.md
3. **不碰用户 CLAUDE.md** -- 如果项目已有 `CLAUDE.md` 且包含用户自定义约束，保持原样不动。只有仅包含 AGENTS.md 引用/软链接的 CLAUDE.md 才可删除
4. **init 自底向上** -- 创建目录级 AGENTS.md 时，先处理叶子目录，再处理父目录，确保父级引用子级时子级已存在
5. **只放项目实际用到的语言** -- `FRACTAL-DOCS.md` 中的头部注释示例只包含检测到的语言，不要放全量语言列表
6. **最小变更原则** -- update 时只更新确实需要变更的文档；纯内部重构不触发目录级文档更新
7. **业务理解走交互** -- check 发现需要填写职责描述的问题时，先读代码形成理解，再带着理解向用户确认，不要猜测

## Gotchas

1. **幽灵条目** -- 文件已删除但 AGENTS.md 业务域清单未同步，导致 Agent 导航到不存在的文件。update/check 时必须比对清单与实际文件
2. **级联断链** -- 子目录有 AGENTS.md 但父目录清单中未登记该子目录，Agent 从上往下导航时会漏掉整个子树
3. **头注释放错位置** -- 每种语言的放置规则不同（Rust 放 `#![...]` 之前，Python 放 shebang 之后，C 头文件放 `#ifndef` 之前）。必须查 `knowledge/header-patterns.md`，不要凭直觉
4. **覆盖用户 CLAUDE.md** -- 用户手写的项目约束被误删/覆盖是最严重的破坏。区分标准：仅含 AGENTS.md 引用 = 可删，含自定义内容 = 不动
5. **init 时包含无关语言** -- 把全部 14 种语言示例都塞进 FRACTAL-DOCS.md，浪费 context。必须先检测项目技术栈再挑选
6. **三行注释靠猜** -- INPUT/OUTPUT/POS 必须基于实际代码内容，不能靠文件名推测。写注释前至少读文件前 50 行 + 公开 API
7. **修改文件时过度更新** -- 仅改内部实现时不应更新目录级 AGENTS.md，只有接口/职责变化才需要级联
8. **check 时直接修复语义问题** -- 幽灵条目、级联断链可自动修复，但缺少 AGENTS.md、遗漏条目的职责描述必须走交互式确认

## 命令速查

| 命令 | 用途 | 详细 SOP |
|------|------|----------|
| `/fractal-docs init` | 为项目初始化三层文档体系 | 读 `prompts/init.md` |
| `/fractal-docs update` | 文件变更后级联更新文档 | 读 `prompts/update.md` |
| `/fractal-docs check` | 验证文档一致性，交互式修复 | 读 `prompts/check.md` |

执行任何命令前，先读取对应的 SOP 文件获取完整步骤。

## 知识库索引（按需加载）

| 文件 | 何时读取 |
|------|----------|
| `knowledge/header-patterns.md` | init/update 添加头部注释时，查各语言注释格式和放置位置 |
| `starter/fractal-protocol.starter.md` | init 创建根 FRACTAL-DOCS.md 时 |
| `starter/root-agents.starter.md` | init 创建根 AGENTS.md 时 |
| `starter/dir-agents.starter.md` | init/update 创建目录级 AGENTS.md 时 |
