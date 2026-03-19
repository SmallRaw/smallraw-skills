---
name: app-analyzer
description: 用户要求分析、逆向、拆解某个 macOS 桌面应用（.app）时触发。包括但不限于：分析 App 技术栈、查看 Bundle 结构、提取资源文件、识别框架依赖、分析二进制符号。不适用于 iOS .ipa 或 Android .apk。
user-invocable: false
disable-model-invocation: false
---

# macOS App 逆向分析工具箱

脚本是工具，决策靠 AI。渐进式探索 .app bundle，按需调用原子工具获取数据，AI 根据发现决定下一步方向。

## 核心规则

1. **脚本只是 executor** — 14 个子命令各干一件事，AI 决定何时调用哪个、按什么顺序
2. **渐进式探索，不做全量扫描** — 先 `app_info` + `app_tree` 拿全貌，再根据发现决定往哪挖
3. **架构识别靠指纹组合** — 读 [架构指纹表](knowledge/arch-fingerprints.md) 了解每种架构的识别模式
4. **源码目录必须逐文件标注** — 提取出的源码目录，每个文件/目录都要标注用途，禁止只列文件名
5. **报告自适应** — 4 个核心章节必出，其余章节按发现生成，没分析到的留 `[待深入]` 占位
6. **执行前 cd 到 skill 目录** — `cd` 到包含此 SKILL.md 的目录再调用脚本
7. **产物输出到 `./docs/dump/<AppName>.analysis/`** — 脚本自动建目录，提取的文件保持原始结构

## Gotchas

1. **大多数 release 二进制是 stripped 的** — `symbols` 可能 exit 3，用 `strings_grep` 做 fallback（搜 `_OBJC_CLASS_$_`、`_$s.*CN$`、框架名等）
2. **`codesign` 信息在 stderr** — `codesign -dv` 输出到 stderr 不是 stdout，脚本已处理
3. **Electron asar 有变体** — `app.asar`、`app-arm64.asar`、unpacked `app/` 目录，`asar_extract` 自动检测
4. **SIP 保护的系统 App 不可读** — `/System/Applications/` 下的 App 部分操作会 exit 2
5. **`otool -l` 输出可能很大** — `headers_dump` 用 `--section` 过滤特定 LC 类型（如 `LC_RPATH`）
6. **exit code 是 AI 的决策信号** — 0=成功、1=参数错、2=执行错、3=数据为空（该换工具了）
7. **`npm_package` 的 `--app` 是可选的** — 如果 package.json 路径是绝对路径可以不传 `--app`

## 报告模板

### 核心章节（必出）

| # | 章节 | 数据来源 |
|---|------|----------|
| 1 | 基本身份 | `app_info` |
| 2 | 技术栈总览 | AI 综合判断 |
| 3 | App Bundle 目录结构 | `app_tree` |
| 4 | 系统框架依赖 | `dylib_list` + `framework_list` |

### 自适应章节（按发现生成，分析不出的留标题占位）

内嵌运行时环境 · 前端技术分析 · 插件/扩展系统 · 模块架构 · 多进程架构 · 网络层 & API · 数据存储 · 系统权限声明 · 资源文件分析 · 核心结论

## 工具速查

| 工具 | 一句话 |
|------|--------|
| `app_info` | Info.plist 基本身份 → JSON |
| `app_tree` | 目录结构树（`--depth`） |
| `file_type` | 识别文件类型（`--path`） |
| `plist_read` | 读任意 plist → JSON（`--path`） |
| `binary_info` | 主二进制架构/大小 → JSON |
| `dylib_list` | 动态库依赖分类 → JSON |
| `headers_dump` | Mach-O 加载命令（`--section`） |
| `symbols` | 符号表（`--filter`/`--demangle`/`--limit`） |
| `strings_grep` | 二进制字符串正则搜索（`--pattern`/`--limit`） |
| `codesign_info` | 签名 + Entitlements → JSON |
| `framework_list` | Frameworks/ 清单 → JSON |
| `resource_extract` | 提取文件/目录到产物目录（`--path`） |
| `asar_extract` | Electron asar 自动检测解包 |
| `npm_package` | 解析 package.json（`--path`） |

## 详细参考

- [工具完整文档](references/tools.md) — 每个工具的参数、输出格式、使用场景、示例
- [架构指纹表](knowledge/arch-fingerprints.md) — Electron/Tauri/Native/Qt/Flutter/CEF 的识别模式和典型分析路径
