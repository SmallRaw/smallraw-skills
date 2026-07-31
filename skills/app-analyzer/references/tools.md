# app-analyzer 工具完整文档

在仓库根目录通过 `python <skill-dir>/scripts/app_analyzer.py <command>` 调用所有工具。

## 公共参数

| 参数 | 必选 | 说明 |
|------|------|------|
| `--app` | 是 | .app bundle 路径（脚本验证路径存在 + Contents/Info.plist） |
| `--output` | 否 | 产物输出目录，默认 `~/.cache/app-analyzer/<AppName>.analysis/` |

## 错误处理

所有子命令遵循统一的 exit code + stderr JSON：

| Exit Code | 含义 | AI 应对 |
|-----------|------|---------|
| 0 | 成功 | 读取输出 |
| 1 | 参数错误 | 修正参数重试 |
| 2 | 执行错误 | 检查权限或环境 |
| 3 | 数据为空 | 换工具或 fallback |

错误输出格式：`{"error": "描述", "code": N, "hint": "建议"}`

---

## 基础探测

### app_info

解析 Info.plist，输出核心元数据。

| 参数 | 仅公共参数 |
|------|-----------|

**输出**：JSON（stdout + `metadata/app_info.json`）
**字段**：BundleID, BundleName, DisplayName, Version, ShortVersion, MinimumOSVersion, Executable, URLSchemes, BuildVersion, DevelopmentTeam

**场景**：分析的第一步，拿到 App 基本身份。

```bash
python <skill-dir>/scripts/app_analyzer.py app_info --app /path/to/X.app
```

---

### app_tree

列出 .app 内部目录结构。

| 参数 | 必选 | 默认 | 说明 |
|------|------|------|------|
| `--depth` | 否 | 3 | 最大目录深度 |

**输出**：文本树（stdout）
**场景**：看全貌，发现关键目录（Frameworks/、Resources/、PlugIns/ 等）。

```bash
python <skill-dir>/scripts/app_analyzer.py app_tree --app /path/to/X.app --depth 4
```

---

### file_type

对 App 内指定文件运行 `file` 命令。

| 参数 | 必选 | 说明 |
|------|------|------|
| `--path` | 是 | App 内相对路径 |

**输出**：文本（stdout）
**场景**：确认文件类型（二进制？脚本？图片？数据库？）

```bash
python <skill-dir>/scripts/app_analyzer.py file_type --app /path/to/X.app --path Contents/MacOS/X
```

---

### plist_read

读取 App 内任意 plist 文件（二进制或 XML 格式均支持）。

| 参数 | 必选 | 说明 |
|------|------|------|
| `--path` | 是 | App 内 plist 文件的相对路径 |

**输出**：JSON（stdout）
**场景**：深入读取 Info.plist 以外的配置文件（如 Entitlements.plist、某个 framework 的 Info.plist）。

```bash
python <skill-dir>/scripts/app_analyzer.py plist_read --app /path/to/X.app --path Contents/Resources/Settings.plist
```

---

## 二进制分析

### binary_info

分析主二进制文件（通过 CFBundleExecutable 定位）。

| 参数 | 仅公共参数 |
|------|-----------|

**输出**：JSON（stdout + `metadata/binary_info.json`）
**字段**：path, file_type, architectures（lipo），size_bytes, size_human

**场景**：了解二进制大小、架构（arm64/x86_64/Universal）、类型。

```bash
python <skill-dir>/scripts/app_analyzer.py binary_info --app /path/to/X.app
```

---

### dylib_list

列出主二进制的动态库依赖。

| 参数 | 仅公共参数 |
|------|-----------|

**输出**：JSON（stdout + `binaries/dylibs.json`）
**分类**：每个 dylib 标记为 system / rpath / embedded / other

**场景**：识别系统框架依赖（AppKit、WebKit、Metal 等）、发现非系统库。

```bash
python <skill-dir>/scripts/app_analyzer.py dylib_list --app /path/to/X.app
```

---

### headers_dump

导出 Mach-O 加载命令。

| 参数 | 必选 | 说明 |
|------|------|------|
| `--section` | 否 | 过滤特定 LC 类型（如 `LC_RPATH`、`LC_LOAD_DYLIB`） |

**输出**：JSON（stdout + `binaries/headers.json`）
**场景**：分析 rpath 配置、最低 OS 版本、代码签名标志等深层信息。建议用 `--section` 过滤，否则输出很大。

```bash
python <skill-dir>/scripts/app_analyzer.py headers_dump --app /path/to/X.app --section LC_RPATH
```

---

### symbols

导出符号表。

| 参数 | 必选 | 默认 | 说明 |
|------|------|------|------|
| `--filter` | 否 | — | 关键词过滤符号名 |
| `--demangle` | 否 | false | 解混淆 Swift/C++ 符号 |
| `--limit` | 否 | 2000 | 最大输出行数 |

**输出**：文本（stdout + `binaries/symbols.txt`）
**Exit 3**：stripped binary 无符号，hint 建议用 `strings_grep`

**场景**：从符号表推断模块架构（Rust crate 路径、Swift 模块名、ObjC 类名）。

```bash
python <skill-dir>/scripts/app_analyzer.py symbols --app /path/to/X.app --filter "agent" --demangle --limit 500
```

---

### strings_grep

从二进制中提取匹配正则的字符串。

| 参数 | 必选 | 默认 | 说明 |
|------|------|------|------|
| `--pattern` | 是 | — | 正则表达式 |
| `--limit` | 否 | 1000 | 最大输出行数 |

**输出**：文本（stdout + `binaries/strings/<sanitized_pattern>.txt`）

**场景**：搜索 URL、API endpoint、框架标识（`tauri`、`electron`）、协议名、密钥等。symbols 失败时的 fallback。

```bash
python <skill-dir>/scripts/app_analyzer.py strings_grep --app /path/to/X.app --pattern "https?://"
python <skill-dir>/scripts/app_analyzer.py strings_grep --app /path/to/X.app --pattern "tauri|wry|webkit"
python <skill-dir>/scripts/app_analyzer.py strings_grep --app /path/to/X.app --pattern "_OBJC_CLASS_\$_"
```

---

## 签名权限

### codesign_info

读取代码签名信息和 Entitlements。

| 参数 | 仅公共参数 |
|------|-----------|

**输出**：JSON（stdout + `metadata/codesign.json`）
**字段**：signing（Authority, TeamIdentifier, Identifier, Format, CodeDirectory flags）、entitlements（解析后的 dict）

**场景**：查看开发团队、签名链、App 申请的系统权限（Camera、Location、Microphone 等）。

```bash
python <skill-dir>/scripts/app_analyzer.py codesign_info --app /path/to/X.app
```

---

## 框架

### framework_list

列出 Contents/Frameworks/ 下的所有 framework。

| 参数 | 仅公共参数 |
|------|-----------|

**输出**：JSON（stdout + `frameworks/framework_list.json`）
**字段**：每个 framework 的 name, architecture, size_bytes, size_human

**Exit 3**：没有 Frameworks/ 目录

**场景**：识别嵌入的第三方框架（Electron Framework、Sparkle、Chromium Embedded Framework 等）。

```bash
python <skill-dir>/scripts/app_analyzer.py framework_list --app /path/to/X.app
```

---

## 提取

### resource_extract

将 App 内的文件或目录复制到产物目录。

| 参数 | 必选 | 说明 |
|------|------|------|
| `--path` | 是 | App 内相对路径 |

**输出**：提取后的绝对路径（stdout）
**目标**：`<output>/extracted/<path>`，保持原始目录结构

**场景**：提取感兴趣的资源（前端代码、配置文件、技能包、脚本等）供深入分析。

```bash
python <skill-dir>/scripts/app_analyzer.py resource_extract --app /path/to/X.app --path Contents/Resources/browser-runtime
```

---

### asar_extract

自动检测并解包 Electron asar 归档。

| 参数 | 仅公共参数 |
|------|-----------|

**检测顺序**：`app.asar` → `app-arm64.asar` → `app-x64.asar` → unpacked `app/` 目录
**依赖**：`npx @electron/asar`（需要 Node.js）
**Exit 2**：Node.js 不可用
**Exit 3**：未找到 asar 文件

**输出**：提取后的绝对路径（stdout），提取到 `<output>/extracted/asar_contents/`

**场景**：提取 Electron App 的前端源码和 package.json。

```bash
python <skill-dir>/scripts/app_analyzer.py asar_extract --app /path/to/X.app
```

---

## 包管理

### npm_package

解析 package.json。

| 参数 | 必选 | 说明 |
|------|------|------|
| `--path` | 是 | package.json 路径（绝对路径，或相对于 `--app`） |
| `--app` | 否 | .app 路径（用于解析相对 `--path`） |

**输出**：JSON（stdout）
**字段**：name, version, dependencies, devDependencies, scripts

**场景**：分析 Electron App 提取出的 package.json，了解前端依赖和构建脚本。

```bash
python <skill-dir>/scripts/app_analyzer.py npm_package --path /path/to/extracted/package.json
```
