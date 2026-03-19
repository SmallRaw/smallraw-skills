# app-analyzer 设计规格

## 概述

一个 macOS App 逆向分析 Skill，采用**工具箱模式**：脚本是底层 executor，AI 驱动渐进式探索，决策权在 AI。

**场景优先级**：学习研究 > 竞品分析 > 安全审计（按需）

**平台**：macOS 优先（`.app` bundle）

## 核心理念

1. 脚本只是工具，是一个个原子化的子工具
2. AI 需要数据时，主动调用对应工具获取
3. AI 根据每一步的发现，决定下一步用什么工具、往哪个方向深挖
4. 不做全量扫描，渐进式探索

## Skill 文件结构

```
skills/app-analyzer/
├── SKILL.md                    # 触发条件 + 核心规则 + 工具索引
├── references/
│   └── tools.md                # 14 个工具的完整说明：参数、输出、使用场景
├── scripts/
│   └── app_analyzer.py         # 单文件，所有工具作为子命令
└── knowledge/
    └── arch-fingerprints.md    # 架构指纹表（Electron/Tauri/Native 等识别模式）
```

## 工具箱（14 个子命令）

### 基础探测

| 工具 | 说明 | 输出 |
|------|------|------|
| `app_info` | 解析 Info.plist，返回 Bundle ID、版本、最低系统等基本身份 | JSON |
| `app_tree` | 列出 .app 内部目录结构（可控深度，默认 3） | 文本树 |
| `file_type` | 对指定文件执行 file 命令，识别类型 | 文本 |
| `plist_read` | 读取 App 内任意 plist 文件 | JSON |

### 二进制分析

| 工具 | 说明 | 输出 |
|------|------|------|
| `binary_info` | 分析主二进制：架构、大小、类型（Mach-O/Universal），含 lipo 信息 | JSON |
| `dylib_list` | 列出动态库依赖（otool -L） | JSON |
| `headers_dump` | Mach-O 段信息（otool -l），支持 `--section` 过滤特定加载命令 | JSON |
| `symbols` | 导出符号表（nm），支持 `--filter`、`--demangle`、`--limit`（默认 2000 行） | 文本 |
| `strings_grep` | 从二进制提取字符串，支持正则过滤，`--limit`（默认 1000 行） | 文本 |

### 签名权限

| 工具 | 说明 | 输出 |
|------|------|------|
| `codesign_info` | 读取代码签名和 Entitlements | JSON |

### 框架

| 工具 | 说明 | 输出 |
|------|------|------|
| `framework_list` | 列出 Frameworks/ 下所有 framework 及其基本信息 | JSON |

### 提取

| 工具 | 说明 | 输出 |
|------|------|------|
| `resource_extract` | 将指定路径的文件/目录从 App 中复制到分析产物目录 | 路径 |
| `asar_extract` | 解包 Electron 的 asar 文件到产物目录（自动检测 app.asar / app-arm64.asar 等变体） | 路径 |

### 包管理

| 工具 | 说明 | 输出 |
|------|------|------|
| `npm_package` | 解析 package.json，列出依赖和 scripts | JSON |

### 工具合并说明

- `swift_demangle` 合并为 `symbols --demangle` 选项
- `lipo_info` 合并进 `binary_info`（自动检测 Universal Binary 并报告所有架构）

## 脚本调用方式

```bash
python scripts/app_analyzer.py <command> --app /path/to/X.app [--output ./docs/dump/X.analysis] [command-specific-args]
```

- `--app`：必选，.app 路径（脚本验证路径存在且包含 `Contents/Info.plist`）
- `--output`：产物输出目录，默认 `./docs/dump/<AppDisplayName>.analysis/`（AppDisplayName 取自 `CFBundleDisplayName`，fallback 到 `CFBundleName`，再 fallback 到目录名）
- 每个子命令的详细参数见 `references/tools.md`（在实现阶段补全）

## 错误处理契约

所有子命令遵循统一的错误处理规范：

### Exit Code

| Code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 参数错误（路径不存在、缺少必选参数） |
| 2 | 执行错误（系统命令失败、权限不足） |
| 3 | 数据为空（命令成功但无有效输出，如 stripped binary 无符号） |

### 输出格式

- **成功**：JSON 工具输出到 stdout，文本工具输出到 stdout
- **错误**：JSON 格式输出到 stderr：`{"error": "描述", "code": N, "hint": "建议的替代方案"}`
- **数据为空（exit 3）**：stderr 输出 hint 告诉 AI 可以尝试什么替代方案

### 示例

```bash
# 成功
$ python app_analyzer.py symbols --app /path/to/X.app --filter "agent"
_$s5Agent10...  # 符号表输出

# stripped binary，无符号
$ python app_analyzer.py symbols --app /path/to/X.app
# exit code 3, stderr:
{"error": "binary is stripped, no local symbols found", "code": 3, "hint": "try strings_grep for keyword discovery, or symbols --demangle for exported symbols only"}

# 权限不足
$ python app_analyzer.py app_tree --app /System/Applications/Calculator.app
# exit code 2, stderr:
{"error": "permission denied: SIP-protected app", "code": 2, "hint": "system apps under /System/Applications/ are protected by SIP"}
```

AI 根据 exit code 和 hint 决定下一步策略，而非盲目重试。

## 符号分析的局限性与 Fallback

大多数 release 构建的二进制会被 `strip`，`nm` 只能看到外部符号（`U` 类型）和导出符号。

### Fallback 策略

| 场景 | 主工具 | Fallback |
|------|--------|----------|
| 符号表为空/极少 | `symbols` | `strings_grep` 搜索关键词（模块名、框架名、URL） |
| Swift 类名发现 | `symbols --demangle` | `strings_grep --pattern "_\$s.*C[N]$"` 匹配 Swift 类元数据 |
| ObjC 类名发现 | `symbols --filter "OBJC_CLASS"` | `strings_grep --pattern "_OBJC_CLASS_\$_"` |
| 模块结构推断 | `symbols` 路径分析 | `strings_grep` + `app_tree` 资源目录结构 |

AI 在 `symbols` 返回 exit code 3 时，应自动切换到 fallback 策略。

## 产物目录结构

```
./docs/dump/<AppName>.analysis/
├── metadata/
│   ├── app_info.json           # Info.plist 解析结果
│   ├── codesign.json           # 签名 + Entitlements
│   └── binary_info.json        # 主二进制基本信息
├── binaries/
│   ├── dylibs.json             # 动态库依赖
│   ├── headers.json            # Mach-O 段/加载命令
│   ├── symbols.txt             # 符号表
│   └── strings/                # strings_grep 输出，按查询存
│       ├── urls.txt
│       └── frameworks.txt
├── frameworks/
│   └── framework_list.json     # Framework 清单及基本信息
├── extracted/                  # resource_extract / asar_extract 提取的文件
│   ├── browser-runtime/        # 示例：提取出的前端代码
│   └── package.json            # 示例：提取出的 Electron 依赖
├── raw/                        # 原始命令输出存档（AI 觉得需要时才存）
└── REPORT.md                   # AI 生成的最终报告
```

- 脚本每次输出直接写到对应子目录（子目录按需自动创建）
- `extracted/` 保持原始目录结构

## 架构指纹识别

AI 通过组合工具输出来识别 App 架构类型：

| 架构 | 识别方式 | 用到的工具 |
|------|---------|-----------|
| **Electron** | `Frameworks/Electron Framework.framework` + `resources/app.asar`（或 `app-arm64.asar`、unpacked `app/` 目录） | `app_tree` + `framework_list` |
| **Tauri** | 无 Frameworks、Rust 二进制、strings 含 `tauri`/`wry` | `binary_info` + `strings_grep` + `dylib_list` |
| **原生 Swift/ObjC** | AppKit/SwiftUI linked、Swift mangled symbols、.storyboard/.xib | `dylib_list` + `symbols` + `app_tree` |
| **Qt** | `QtCore.framework`、`qml/` 目录 | `framework_list` + `app_tree` |
| **Flutter** | `FlutterMacOS.framework`、`App.framework` | `framework_list` |
| **Java/JVM** | embedded JRE、.jar 文件 | `app_tree` + `file_type` |
| **CEF** | `Chromium Embedded Framework.framework` | `framework_list` |

## 报告模板（自适应）

### 核心章节（必出）

| # | 章节 | 数据来源 |
|---|------|----------|
| 1 | 基本身份 | `app_info` |
| 2 | 技术栈总览 | AI 综合判断（架构指纹 + dylibs + frameworks） |
| 3 | App Bundle 目录结构 | `app_tree` |
| 4 | 系统框架依赖 | `dylib_list` + `framework_list` |

### 自适应章节（按发现生成）

| 章节 | 触发条件 |
|------|---------|
| 内嵌运行时环境 | 发现 Node/Bun/Python/JRE 等运行时 |
| 前端技术分析 | Electron/Tauri/CEF，有可提取的前端代码 |
| 插件/技能/扩展系统 | 发现 plugins/skills/extensions 目录或相关符号 |
| 模块架构（从符号反推） | 符号表中有清晰的模块路径（如 Rust crate 路径） |
| 多进程/子进程架构 | 发现多个可执行文件或 Helper |
| 网络层 & API | strings 发现 URL/API endpoint/协议 |
| 数据存储 | 发现 SQLite/CoreData/Realm 等依赖 |
| 安全架构 | 用户主动要求时展开 |
| 系统权限声明 | Entitlements 中有非空权限 |
| 资源文件分析 | 发现有价值的配置文件/资源包 |
| 核心结论 | 始终作为最后一章 |

### 源码目录分析规则

对已提取的源码目录，**必须逐文件分析用途并标注在目录树中**，不允许只列文件名。示例：

```markdown
browser-runtime/src/
├── main.ts              # 入口
├── browser/             # 浏览器控制
│   ├── cdp.ts           # Chrome DevTools Protocol 客户端
│   ├── chrome.ts        # Chrome 启动管理
│   ├── client.ts        # 浏览器客户端
│   ├── client-actions.ts # 页面操作 (点击/输入/观察等)
```

### 未深入章节占位

```markdown
## 插件/扩展系统
> [待深入] 发现 Resources/bundled-skills/ 目录，包含 7 个 zip 包。可进一步分析技能包格式和内容。
```

用户后续对话中可要求展开某个占位章节，AI 继续调用工具深挖补全。

## AI 决策链路示例

### Electron App

```
app_info → 基本身份
app_tree → 看到 Electron Framework.framework + app.asar (或 app-arm64.asar / unpacked app/)
  → AI 判断: Electron 应用
  → asar_extract → 提取前端代码（自动检测 asar 变体）
  → npm_package → 看依赖（React? Vue? Electron 版本?）
  → 逐文件分析提取出的源码
  → resource_extract → 提取感兴趣的模块
```

### Tauri App

```
app_info → 基本身份
app_tree → 没有 Frameworks/，Resources 下有 web 资源
binary_info → 大体积 arm64 单二进制
strings_grep "tauri|wry" → 命中
  → AI 判断: Tauri 应用
  → symbols → 从 Rust 路径反推模块架构
  → resource_extract → 提取 web 资源和配置
  → 逐文件分析模块用途
```

### 原生 App

```
app_info → 基本身份
dylib_list → AppKit/SwiftUI linked
symbols → 可能 exit 3 (stripped)
  → fallback: strings_grep --pattern "_OBJC_CLASS_\$_|_\$s.*CN$"
app_tree → .storyboard/.xib 文件
  → AI 判断: 原生 Swift/ObjC
  → 从可用信息反推模块结构
```

## 已知限制

| 限制 | 说明 |
|------|------|
| SIP 保护 | `/System/Applications/` 下的系统 App 不可读，工具返回 exit 2 |
| Stripped Binary | 大多数 release 构建无本地符号，需依赖 fallback 策略 |
| 加密/混淆 | 部分 App 可能对资源文件做加密或混淆，提取后不可读 |
| 动态加载 | `dlopen` 加载的库不在 `otool -L` 输出中 |

## 依赖

- Python 3.x（标准库：`subprocess`、`json`、`plistlib`、`pathlib`、`shutil`、`argparse`、`re`）
- macOS 系统命令：`otool`、`nm`、`strings`、`codesign`、`file`、`lipo`、`plutil`、`xcrun swift-demangle`
- 可选：`npx @electron/asar`（Electron asar 解包，需 Node.js）
