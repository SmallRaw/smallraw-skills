---
name: fractal-docs
description: 分形文档协议维护工具。使用 /fractal-docs init 为项目初始化三层文档体系，/fractal-docs update 级联更新文档，/fractal-docs check 检查一致性并交互式修复。
license: MIT
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: true
---

# /fractal-docs - 分形文档协议维护工具

分形文档协议的定义在项目的 `FRACTAL-DOCS.md` 中，AI Agent 读项目时直接按协议导航即可。本 skill 是协议的**维护工具**，提供三个命令。

## 命令

| 命令 | 用途 | 详细 SOP |
|------|------|----------|
| `/fractal-docs init` | 为项目初始化三层文档体系 | 读 `prompts/init.md` |
| `/fractal-docs update` | 文件变更后级联更新文档 | 读 `prompts/update.md` |
| `/fractal-docs check` | 验证文档一致性，交互式修复 | 读 `prompts/check.md` |

执行任何命令前，先读取对应的 SOP 文件获取完整步骤。

## 知识库（按需加载）

| 文件 | 何时读取 |
|------|----------|
| `knowledge/header-patterns.md` | init/update 添加头部注释时，查各语言注释格式 |
| `starter/fractal-protocol.starter.md` | init 创建根 FRACTAL-DOCS.md 时 |
| `starter/root-agents.starter.md` | init 创建根 AGENTS.md 时 |
| `starter/dir-agents.starter.md` | init/update 创建目录级 AGENTS.md 时 |
