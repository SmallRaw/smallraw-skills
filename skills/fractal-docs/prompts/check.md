---
description: Check fractal documentation consistency
---

# 分形文档一致性检查

验证三层文档体系的完整性和一致性。

## 执行步骤

### 1. 扫描项目结构

列出所有源码目录和源码文件。

排除：
- 构建产物目录（`target/`, `dist/`, `build/`, `node_modules/`）
- 隐藏目录（`.git/`, `.vscode/`, `.idea/`）
- 非源码文件（配置、文档、数据、资源文件）

### 2. 检查第一层：三行头部注释

对每个源码文件检查：

- [ ] 文件是否有 INPUT/OUTPUT/POS 三行注释
- [ ] 注释位置是否正确（在 import/include 之前）
- [ ] 注释格式是否标准（`// INPUT:  ...` 两空格对齐）

输出缺失列表：

```
缺少三行注释的文件：
- src/new_file.rs
- src/utils/helper.py
```

### 3. 检查第二层：目录级 AGENTS.md

对每个包含源码文件的目录检查：

- [ ] 是否存在 `AGENTS.md`
- [ ] 是否存在 `CLAUDE.md`？→ 需区分处理：
  - 仅包含 AGENTS.md 引用/软链接 → 应删除
  - 包含用户自定义约束 → 不要动它，保持原样
- [ ] 是否包含必要章节（地位、逻辑、约束、业务域清单）
- [ ] 业务域清单是否与目录内实际文件一一对应：
  - 清单中列出但实际不存在的文件 → **幽灵条目**
  - 实际存在但清单中未列出的文件 → **遗漏条目**

输出不一致列表：

```
AGENTS.md 不一致：
- src/AGENTS.md:
  - 幽灵条目: old_module.rs（文件已删除）
  - 遗漏条目: new_module.rs（文件未登记）
- src/menu/AGENTS.md: OK
- src/: 存在 CLAUDE.md（仅引用 AGENTS.md，可删除）
- lib/: 存在 CLAUDE.md（包含用户自定义约束，不要动）
```

### 4. 检查根目录 FRACTAL-DOCS.md

- [ ] 根目录是否存在 `FRACTAL-DOCS.md`
- [ ] 根 `AGENTS.md` 是否包含指向 `FRACTAL-DOCS.md` 的引用行
- [ ] `FRACTAL-DOCS.md` 中的头部注释示例是否与项目实际使用的语言一致

输出不一致列表：

```
FRACTAL-DOCS.md 检查：
- 缺少 FRACTAL-DOCS.md（需创建）
- 根 AGENTS.md 缺少协议引用行
- FRACTAL-DOCS.md 包含未使用的语言示例: Shell
```

### 5. 检查级联完整性

从叶子目录到根目录，检查引用链：

- [ ] 每个子目录在其父目录的 AGENTS.md 业务域清单中有对应条目
- [ ] 根 AGENTS.md 的业务域清单覆盖所有一级源码目录

输出断链列表：

```
级联断链：
- src/utils/ 未在 src/AGENTS.md 的业务域清单中登记
```

### 6. 生成报告

汇总所有检查结果：

```markdown
## 分形文档一致性报告

### 统计
- 源码文件：{N} 个
- 有头部注释：{M} 个（{M/N*100}%）
- 源码目录：{D} 个
- 有 AGENTS.md：{C} 个（{C/D*100}%）

### 问题
- 缺少头部注释：{count} 个文件
- 缺少 AGENTS.md：{count} 个目录
- 缺少 FRACTAL-DOCS.md：{yes/no}
- CLAUDE.md 仅引用 AGENTS.md：{count} 个（可删除）
- CLAUDE.md 含用户自定义约束：{count} 个（保持原样）
- 幽灵条目：{count} 条
- 遗漏条目：{count} 条
- 级联断链：{count} 处

### 修复建议
1. ...
2. ...
```

## 输出

- 如果全部通过：输出简短确认
- 如果有问题：输出报告 → 推荐交互式修复

## 交互式修复（推荐）

业务语义、模块定位只有开发者最清楚，不要直接猜测。发现问题后带着具体问题逐项询问用户。

**流程**：

1. 汇总所有问题，按优先级排序：缺失 AGENTS.md > 遗漏条目 > 头部注释模糊/缺失 > 幽灵条目
2. 逐项向用户提问，每次聚焦一个具体问题
3. 提问前先阅读代码，形成自己的理解，再带着理解去确认——不要问笼统的"这个文件是干什么的"
4. 遇到 POS 描述模糊的，给出改进建议让用户确认或修正
5. 用用户的回答立即更新对应文档
6. 全部问完后再跑一次 check 确认

**示例**：

```
检查发现以下问题，我逐个和你确认：

1. src/parser/ 缺少 AGENTS.md
   我读了代码，看起来是协议解析模块，包含 BLE 和 USB 两种协议的 parser。
   → 这个理解对吗？还有什么约束或注意事项？

2. src/display/render.rs 的 POS 写的是"渲染工具"，太模糊了
   从代码看它负责 OLED 128x64 的帧缓冲渲染，支持中英文混排。
   → 建议改为"OLED 帧缓冲渲染，128x64 中英文混排"，可以吗？

3. src/ble/AGENTS.md 业务域清单缺少 security.rs
   这个文件处理 BLE 配对和密钥管理。
   → 职责描述写"BLE 配对流程与密钥存储管理"合适吗？
```

## 自动修复

对于纯机械性问题（幽灵条目、级联断链、CLAUDE.md 清理），可以不询问直接修复：

- **幽灵条目**：从清单中删除
- **级联断链**：添加缺失的父级条目
- **CLAUDE.md 仅引用 AGENTS.md**：直接删除
- **CLAUDE.md 含用户自定义约束**：不要动，保持原样
- **缺少 FRACTAL-DOCS.md**：基于 `starter/fractal-protocol.starter.md` 模板创建
- **根 AGENTS.md 缺少协议引用**：添加指向 FRACTAL-DOCS.md 的引用行

涉及业务理解的问题（缺少头部注释、缺少 AGENTS.md、遗漏条目的职责描述），走交互式修复。

修复后再次运行检查，确认全部通过。
