# 架构指纹识别表

AI 通过组合多个工具输出来识别 App 的技术架构。每种架构有独特的"指纹"。

## Electron

**关键特征：**
- `app_tree`: 存在 `Contents/Frameworks/Electron Framework.framework`
- `app_tree`: 存在 `Contents/Resources/app.asar`（或 `app-arm64.asar`、`app-x64.asar`、unpacked `app/` 目录）
- `framework_list`: 包含 `Electron Framework.framework`
- `binary_info`: 主二进制通常 > 100MB（包含 Chromium）

**典型分析路径：**
```
app_info → app_tree → 看到 Electron Framework + asar
  → framework_list → 确认 Electron，查看版本
  → asar_extract → 提取前端代码
  → npm_package → 读 package.json，了解依赖（React/Vue/Angular? Electron 版本?）
  → resource_extract → 提取感兴趣的模块
  → 逐文件分析提取出的源码目录
```

**注意：** 部分 Electron App 不用 asar（如 Cursor 使用 unpacked `app/` 目录），有些用架构特定的 asar 文件。`asar_extract` 会自动检测这些变体。

---

## Tauri

**关键特征：**
- `app_tree`: **没有** `Contents/Frameworks/` 目录（或为空）
- `binary_info`: 单个大体积 arm64 二进制（纯 Rust 编译）
- `strings_grep --pattern "tauri|wry"`: 命中 tauri/wry 相关字符串
- `dylib_list`: 依赖 WebKit.framework（系统 WebView）但没有嵌入浏览器引擎

**典型分析路径：**
```
app_info → app_tree → 无 Frameworks/，Resources 下有 web 资源
  → binary_info → 大体积单二进制
  → strings_grep "tauri|wry" → 确认 Tauri
  → symbols → 从 Rust crate 路径（如 src/agent/runtime/）反推模块架构
  → resource_extract → 提取 web 资源、配置文件
  → 逐文件分析模块用途
```

**注意：** Tauri 2.x 使用 Isolation Pattern，可能有 `tauriipc://` 自定义协议。用 `strings_grep --pattern "tauriipc|ipc-config"` 确认。

---

## 原生 Swift

**关键特征：**
- `dylib_list`: 链接 AppKit/SwiftUI/UIKit 等系统框架
- `symbols --demangle`: Swift mangled 符号（`_$s` 前缀）
- `app_tree`: 可能有 `.storyboard`、`.xib`、`.nib` 文件
- `strings_grep --pattern "_\$s.*CN\$"`: Swift 类元数据

**典型分析路径：**
```
app_info → dylib_list → 看到 AppKit/SwiftUI
  → symbols --demangle → 读 Swift 模块名和类名
  → 如果 stripped → strings_grep --pattern "_\$s.*CN\$" 做 fallback
  → app_tree → 找 .storyboard/.xib 等 UI 资源
  → codesign_info → 查看 Entitlements（权限声明）
```

---

## 原生 Objective-C

**关键特征：**
- `dylib_list`: 链接 AppKit 等系统框架
- `symbols --filter "OBJC_CLASS"`: ObjC 类符号
- `strings_grep --pattern "_OBJC_CLASS_\$_"`: ObjC 类名
- 无 Swift mangled 符号

**典型分析路径：**
```
app_info → dylib_list → 看到 AppKit 但没有 Swift 标准库
  → symbols --filter "OBJC_CLASS" → 读 ObjC 类名
  → 如果 stripped → strings_grep --pattern "_OBJC_CLASS_\$_"
  → app_tree → 找 .nib/.storyboard
```

---

## Qt

**关键特征：**
- `framework_list`: 包含 `QtCore.framework`、`QtWidgets.framework`、`QtGui.framework`
- `app_tree`: 可能有 `qml/` 目录（QML UI）、`plugins/` 目录
- `strings_grep --pattern "qt_version|QApplication"`: Qt 相关字符串

**典型分析路径：**
```
app_info → app_tree → 看到 Qt framework
  → framework_list → 列出所有 Qt 模块（Core/Widgets/Network/WebEngine 等）
  → app_tree → 查找 qml/ 和 plugins/ 目录
  → resource_extract → 提取 QML 源码
```

---

## Flutter

**关键特征：**
- `framework_list`: 包含 `FlutterMacOS.framework`
- `app_tree`: 包含 `App.framework`（Dart AOT 编译产物）
- `binary_info`: App.framework 内的二进制包含 Dart 快照

**典型分析路径：**
```
app_info → framework_list → 看到 FlutterMacOS.framework
  → app_tree → 找到 App.framework
  → binary_info 分析 Flutter 和 App framework
  → strings_grep → 搜索 Dart 相关字符串
```

**注意：** Flutter 的 Dart 代码编译为 AOT 快照，难以直接反编译。重点分析资源文件和 framework 版本。

---

## Java/JVM

**关键特征：**
- `app_tree`: 包含 `Contents/Java/` 或嵌入的 JRE/JDK（`Contents/Home/`、`jre/`）
- `app_tree`: 存在 `.jar` 文件
- `file_type`: 对 .jar 文件识别为 "Java archive"

**典型分析路径：**
```
app_info → app_tree → 发现 Java/ 目录或 .jar 文件
  → file_type → 确认 jar 文件类型
  → resource_extract → 提取 jar 文件（jar 本质是 zip，可进一步分析）
```

---

## CEF (Chromium Embedded Framework)

**关键特征：**
- `framework_list`: 包含 `Chromium Embedded Framework.framework`
- 类似 Electron 但没有 `Electron Framework`
- 主二进制是原生代码（C++/ObjC），WebView 用 CEF

**典型分析路径：**
```
app_info → framework_list → 看到 Chromium Embedded Framework
  → 不是 Electron（无 Electron Framework）
  → binary_info + symbols → 分析主二进制（通常是 C++/ObjC）
  → app_tree → 找 web 资源目录
  → resource_extract → 提取前端代码
```

---

## 混合架构

现实中很多 App 是混合架构。例如：

- **Tauri + 嵌入运行时**：Tauri 主框架 + 内嵌 Node.js/Python/Bun
- **Native + WebView**：原生框架 + WKWebView 加载 web 内容
- **Electron + Native 模块**：Electron 前端 + 原生 .node addon

**识别策略：** 先用指纹确定主架构，再通过 `app_tree` 和 `strings_grep` 发现附加组件。不要假设 App 只有一种技术栈。
