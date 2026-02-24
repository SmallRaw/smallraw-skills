---
description: Initialize Fractal Documentation Protocol for a project
---

# 分形文档协议初始化

为当前项目建立完整的三层分形文档体系。

## 执行步骤

### 阶段 1：项目分析

1. **检测项目技术栈**
   - 读取构建配置（`Cargo.toml`, `package.json`, `go.mod`, `pyproject.toml` 等）
   - 识别主要语言和框架
   - 识别构建命令

2. **检测项目语言**
   按 `knowledge/header-patterns.md` 末尾的"语言检测方法"表，扫描项目文件确定使用了哪些语言。
   记录检测结果，例如：`[Rust, C, C头文件, Python, Shell]`

3. **扫描项目结构**
   - 列出所有源码目录（排除 `target/`, `node_modules/`, `dist/`, `.git/` 等）
   - 列出所有源码文件（按目录分组）
   - 识别入口文件、配置文件、测试文件

4. **检查已有文档**
   - 是否存在 `AGENTS.md`？→ 合并而非覆盖
   - 是否存在 `CLAUDE.md`？→ 需要区分处理：
     - 如果仅包含对 `AGENTS.md` 的引用/软链接 → 直接删除
     - 如果包含用户自定义的项目约束 → **不要动它**，用户自己维护的文件保持原样
   - 是否已有头部注释？→ 保留，补充缺失的字段

### 阶段 2：创建根 AGENTS.md

基于 `starter/root-agents.starter.md` 模板，填充：

1. 项目名称和一句话描述

2. **拼装头部注释示例**（关键步骤）
   根据阶段 1 检测到的语言列表，从 `knowledge/header-patterns.md` 的"语言示例库"中，
   挑选对应语言的示例块，拼装替换模板中的 `{HEADER_EXAMPLES}` 占位符。

   **只放项目实际用到的语言**，不要放无关语言。

   示例：如果项目用 Rust + C + Python，则拼装后的效果为：

   ````markdown
   #### Rust (`*.rs`)

   ```rust
   // INPUT:  embassy_nrf(twim, gpio), embedded_graphics, rmk
   // OUTPUT: pub run_display() async task
   // POS:    OLED 显示主循环，30FPS 菜单 / 1FPS 首页
   #![no_std]
   #![no_main]

   use embassy_nrf::twim::Twim;
   ```

   #### C 源文件 (`*.c`) / 头文件 (`*.h`)

   ```c
   // INPUT:  WouoUI.h, WouoUI_page.h
   // OUTPUT: WouoUI_Init(), WouoUI_Tick(), page dispatch
   // POS:    WouoUI 主状态机，驱动页面调度和动画循环
   #include "WouoUI.h"
   ```

   #### Python (`*.py`)

   ```python
   #!/usr/bin/env python3
   # INPUT:  struct, sys, zlib
   # OUTPUT: patched firmware.bin (in-place)
   # POS:    构建后处理：为固件 bin 补丁 CRC32 完整性校验值
   """Patch firmware binary with CRC32."""

   import struct
   ```
   ````

3. 如果有旧的 `CLAUDE.md`，按以下策略处理：
   - **仅包含 AGENTS.md 引用/软链接**：直接删除
   - **包含用户自定义内容**：**不要动它**，保持原样。用户自己维护的约束文件不属于本协议的管理范围。

4. 顶层业务域清单（每个一级目录/文件一行）

### 阶段 3：创建目录级 AGENTS.md

**对每个包含源码文件的目录**，基于 `starter/dir-agents.starter.md` 模板创建 `AGENTS.md`：

1. 阅读目录下所有源码文件（至少前 30-50 行）
2. 理解模块职责和内部分工
3. 填写：
   - **模块名**：简短的中文名称
   - **一句话定位**：这个模块做什么
   - **地位**：在上级模块/项目中的角色
   - **逻辑**：内部数据流/调用关系
   - **约束**：技术限制、编码规范
   - **业务域清单**：每个文件/子目录一行

**目录遍历顺序**：自底向上。先处理叶子目录，再处理父目录，确保父目录的清单引用子目录时子目录已有 AGENTS.md。

**注意**：只创建 `AGENTS.md`，不创建 `CLAUDE.md`。`AGENTS.md` 是跨工具通用协议，Claude Code、Cursor、Windsurf、OpenCode 等工具均可直接识别。避免同时存在多个文档文件导致重复读取浪费 context。

### 阶段 4：添加三行头部注释

**对每个源码文件**添加 INPUT/OUTPUT/POS 三行注释。

查阅 `knowledge/header-patterns.md` 确定该文件语言对应的：
- 注释符（`//` / `#` / `--`）
- 放置位置（shebang 之后？`#![...]` 之前？`#ifndef` 之前？）

**编写流程**：
1. 阅读文件内容，理解其依赖、导出和职责
2. 编写三行注释
3. 使用 Edit 工具将注释插入到文件正确位置
4. 保留文件原有的描述性注释（移到三行注释之后）

**并行化**：不同目录的文件可以并行处理。推荐使用 Team 机制，每个 Agent 处理一个目录或一种语言。

### 阶段 5：验证

1. **编译验证**：运行项目的构建/检查命令
   - Rust: `cargo check`
   - Node: `npm run build` 或 `tsc --noEmit`
   - Go: `go build ./...`
   - Python: `python -m py_compile` 或 `mypy`
2. **一致性验证**：运行 `/fractal-docs check`（参见 check.md）

### 阶段 6：清理

- 如果 `CLAUDE.md` 仅是 AGENTS.md 的引用/软链接，确认已删除
- 如果 `CLAUDE.md` 包含用户自定义内容，确认未被修改
- 确认 git status，告知用户变更的文件列表

## 注意事项

- **不要猜测**：每个文件的 INPUT/OUTPUT/POS 必须基于实际代码内容，不能靠文件名推测
- **阅读优先**：写注释前必须阅读文件（至少前 50 行 + 公开 API 部分）
- **保守原则**：不确定的接口宁可不列，也不要列错
- **不破坏代码**：三行注释是纯注释，绝对不能改变任何代码逻辑
- **并行加速**：文件多时使用 Team 机制并行处理，一个 Agent 处理 AGENTS.md，其他处理头部注释
- **只放相关语言**：根 AGENTS.md 中的示例只包含项目实际使用的语言，不要放全量语言列表
