---
name: fractal-docs
description: 分形文档协议 - 三层自描述文档体系，让 AI Agent 快速理解任意模块
license: MIT
compatibility: claude-code, opencode
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: false
---

# /fractal-docs - 分形文档协议 Skill

> 核心理念：**代码即文档，文档即协议。每一级目录自包含地描述自身。**

---

## 解决什么问题

AI Agent 进入一个新项目时，需要花大量时间"摸底"：
- 这个文件是干什么的？依赖什么？对外暴露什么？
- 这个目录是什么模块？内部怎么分工？
- 整个项目的模块关系是怎样的？

分形文档协议通过三层自描述结构解决这些问题。Agent 进入任何目录，都能在 **3 秒内** 理解上下文。

---

## 三层协议结构

### 第一层：源码文件三行头部注释

每个源码文件最前面放三行结构化注释：

```
// INPUT:  依赖什么（模块、crate、外部服务）
// OUTPUT: 提供什么（公开 API、task、channel、类型）
// POS:    在系统中的地位（一句话定位）
```

- Rust/C/C++/Go/JS/TS 用 `//`
- Python/Shell/TOML/YAML 用 `#`
- 放在文件最前面（shebang 行之后），在任何 `use`/`#include`/`import` 之前
- 现有描述性注释保留，移到三行注释之后

### 第二层：目录级 CLAUDE.md

每个源码目录放一个 `CLAUDE.md`，格式统一：

```markdown
# {模块名}
> {一句话定位}

## 地位
## 逻辑
## 约束
## 业务域清单
| 名称 | 文件/子目录 | 职责 |
```

Claude Code 的懒加载机制会在搜索到某目录时自动加载该目录的 `CLAUDE.md`。

### 第三层：级联更新规则

| 触发事件 | 文件级 | 目录级 | 上级目录级 |
|----------|--------|--------|-----------|
| 新增文件 | 添加三行注释 | 更新 CLAUDE.md 清单 | 更新上级清单 |
| 删除文件 | — | 更新 CLAUDE.md 清单 | 更新上级清单 |
| 修改接口/职责 | 更新三行注释 | 更新 CLAUDE.md | 如影响则更新上级 |
| 仅改内部实现 | 检查注释准确性 | 不更新 | 不更新 |

---

## 能力概述

### 1. 初始化（init）

扫描项目，生成完整的三层文档体系：

1. 分析项目结构和技术栈
2. 创建根 `CLAUDE.md`（项目概览 + 协议定义 + 业务域清单）
3. 为每个源码目录创建 `CLAUDE.md`
4. 为每个源码文件添加三行头部注释
5. 验证编译/构建不被破坏

```
/fractal-docs init
```

### 2. 更新（update）

文件变更后，按级联规则更新相关文档：

```
/fractal-docs update           # 扫描变更，自动更新
/fractal-docs update src/foo.rs  # 更新指定文件的文档链
```

### 3. 检查（check）

验证文档一致性：

```
/fractal-docs check            # 全量检查
```

检查项：
- 每个源码文件是否有三行头部注释
- 每个源码目录是否有 CLAUDE.md
- CLAUDE.md 业务域清单与实际文件是否一一对应
- 从叶子到根的级联链路是否完整

---

## 使用方式

### 新项目初始化

```
/fractal-docs init
```

自动完成：
- 检测项目语言和构建系统
- 生成根 CLAUDE.md（合并已有 AGENTS.md 内容，如果存在）
- 递归生成目录 CLAUDE.md
- 为所有源码文件添加三行注释
- 运行构建验证

### 日常维护

开发过程中文件变更后：

```
/fractal-docs update
```

根据 git diff 检测变更，按级联规则更新。

### 定期审计

```
/fractal-docs check
```

生成一致性报告，列出需要修复的条目。

---

## 知识库文件

| 文件 | 用途 |
|------|------|
| `knowledge/header-patterns.md` | 各语言三行注释格式 + 放置规则 |
| `starter/root-claude.starter.md` | 根 CLAUDE.md 模板 |
| `starter/dir-claude.starter.md` | 目录级 CLAUDE.md 模板 |
| `prompts/init.md` | 全量初始化 SOP |
| `prompts/update.md` | 级联更新 SOP |
| `prompts/check.md` | 一致性检查 SOP |

---

## 与 /architect 的关系

| 维度 | /architect | /fractal-docs |
|------|-----------|---------------|
| 关注点 | 行为规范（怎么做） | 代码导航（怎么理解） |
| 产出物 | AGENTS.md / CLAUDE.md 规则段 | 三行注释 + 目录 CLAUDE.md |
| 触发场景 | 流程出错、重复犯错 | 新项目、新模块、AI 理解困难 |
| 演进方式 | 从问题中长出规则 | 从代码结构中提取文档 |

两者互补：
- `/architect init` 建立行为规范
- `/fractal-docs init` 建立导航地图
- 根 CLAUDE.md 可以同时包含两者的内容

---

## 来源

这个 Skill 源自 K9-Pad E73 项目（nRF52840 BLE 键盘固件）的实践。该项目包含 Rust + C FFI + Python 工具链，跨语言模块多，AI Agent 需要快速理解任意模块的上下文。三层分形文档协议在实际开发中验证有效。
