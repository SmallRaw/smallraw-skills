# 三行头部注释模式

> 每个源码文件最前面的 INPUT/OUTPUT/POS 三行注释，是分形文档协议的第一层。
> init 时检测项目语言，将对应语言的示例块拼装进根 CLAUDE.md。

---

## 语言示例库

每个语言块是独立的，init 时按检测结果挑选，直接拼进项目 CLAUDE.md 的"头部注释格式"章节。

---

### Rust

文件类型：`*.rs`，注释符：`//`

三行注释放在 `#![...]` crate attributes **之前**，`use` **之前**：

```rust
// INPUT:  embassy_nrf(twim, gpio), embedded_graphics, rmk
// OUTPUT: pub run_display() async task
// POS:    OLED 显示主循环，30FPS 菜单 / 1FPS 首页
#![no_std]
#![no_main]

use embassy_nrf::twim::Twim;
```

如果没有 `#![...]`，直接放第一行：

```rust
// INPUT:  embassy_sync, heapless
// OUTPUT: DisplayCommand enum, DISPLAY_DATA channel
// POS:    BLE 数据通道协议解析与分发
use embassy_sync::channel::Channel;
```

---

### C 源文件

文件类型：`*.c`，注释符：`//`

三行注释放在 `#include` 和已有注释 **之前**：

```c
// INPUT:  WouoUI.h, WouoUI_page.h
// OUTPUT: WouoUI_Init(), WouoUI_Tick(), page dispatch
// POS:    WouoUI 主状态机，驱动页面调度和动画循环
#include "WouoUI.h"
```

如果文件以 `/** ... */` 块注释开头，三行注释放在块注释 **之前**：

```c
// INPUT:  WouoUI.h
// OUTPUT: K9Pad_MenuInit()
// POS:    K9-Pad 专用菜单树定义
/**
 * WouoUI K9-Pad Menu Configuration
 */
#include "WouoUI.h"
```

---

### C 头文件

文件类型：`*.h`，注释符：`//`

三行注释放在 `#ifndef` / `#pragma once` **之前**：

```c
// INPUT:  WouoUI_common.h
// OUTPUT: AnimPos struct, WouoUI_Animation()
// POS:    动画引擎头文件，定义动画结构体和接口
#ifndef __WOUOUI_ANIM__
#define __WOUOUI_ANIM__
```

---

### C++

文件类型：`*.cpp`, `*.hpp`, `*.cc`, `*.hh`，注释符：`//`

规则同 C 源文件/头文件。额外注意 `namespace` 不影响放置位置：

```cpp
// INPUT:  <memory>, <vector>, "config.h"
// OUTPUT: Engine class, Engine::run()
// POS:    游戏引擎核心，管理主循环和子系统生命周期
#include <memory>
#include "config.h"

namespace engine {
```

---

### Python

文件类型：`*.py`，注释符：`#`

三行注释放在 shebang **之后**、docstring/import **之前**：

```python
#!/usr/bin/env python3
# INPUT:  struct, sys, zlib
# OUTPUT: patched firmware.bin (in-place)
# POS:    构建后处理：为固件 bin 补丁 CRC32 完整性校验值
"""Patch firmware binary with CRC32."""

import struct
```

没有 shebang 时直接放第一行：

```python
# INPUT:  os, json
# OUTPUT: load_config() -> dict
# POS:    配置加载模块，支持环境变量覆盖
import os
import json
```

---

### JavaScript

文件类型：`*.js`, `*.mjs`, `*.cjs`，注释符：`//`

三行注释放在 `'use strict'` / `import` / `require` **之前**：

```javascript
// INPUT:  express, ./routes/api, ./middleware/auth
// OUTPUT: app Express instance, listen()
// POS:    Express 应用初始化，注册路由和中间件
'use strict';

const express = require('express');
```

ESM 风格：

```javascript
// INPUT:  react, ./hooks/useAuth
// OUTPUT: LoginPage component (default export)
// POS:    登录页面，处理 OAuth 认证流程
import React from 'react';
```

---

### TypeScript

文件类型：`*.ts`, `*.tsx`，注释符：`//`

规则同 JavaScript。注意 `.tsx` 中 JSX 不影响放置位置：

```typescript
// INPUT:  react, @tanstack/react-query, ./api/users
// OUTPUT: UserList component, useUsers hook
// POS:    用户列表页，带分页和搜索
import React from 'react';
import { useQuery } from '@tanstack/react-query';
```

---

### Go

文件类型：`*.go`，注释符：`//`

三行注释放在 `package` 声明 **之前**：

```go
// INPUT:  net/http, encoding/json, ./internal/store
// OUTPUT: Server struct, NewServer(), ListenAndServe()
// POS:    HTTP API 服务器入口，注册路由并监听端口
package main

import (
    "net/http"
    "encoding/json"
)
```

---

### Swift

文件类型：`*.swift`，注释符：`//`

三行注释放在 `import` **之前**：

```swift
// INPUT:  SwiftUI, Combine, ./Services/AuthService
// OUTPUT: ContentView struct
// POS:    应用主界面，展示导航和内容区域
import SwiftUI
import Combine
```

---

### Kotlin

文件类型：`*.kt`, `*.kts`，注释符：`//`

三行注释放在 `package` 声明 **之前**：

```kotlin
// INPUT:  kotlinx.coroutines, retrofit2, ./data/UserRepository
// OUTPUT: UserViewModel class
// POS:    用户页 ViewModel，管理用户数据加载和 UI 状态
package com.example.ui.user

import kotlinx.coroutines.flow.StateFlow
```

---

### Java

文件类型：`*.java`，注释符：`//`

三行注释放在 `package` 声明 **之前**：

```java
// INPUT:  spring-boot, ./repository/UserRepo
// OUTPUT: UserController class, REST endpoints /api/users/**
// POS:    用户管理 REST 控制器
package com.example.controller;

import org.springframework.web.bind.annotation.*;
```

---

### Dart

文件类型：`*.dart`，注释符：`//`

三行注释放在 `import` / `library` **之前**：

```dart
// INPUT:  flutter/material, provider, ./services/api
// OUTPUT: HomePage widget
// POS:    应用首页，展示仪表盘和快捷入口
import 'package:flutter/material.dart';
```

---

### Shell

文件类型：`*.sh`, `*.bash`, `*.zsh`, `*.fish`，注释符：`#`

三行注释放在 shebang **之后**：

```bash
#!/bin/bash
# INPUT:  git, cargo, $1(commit msg), $2..(files)
# OUTPUT: git commit (staged specified files only)
# POS:    安全提交脚本，防止 git add . 误操作
set -euo pipefail
```

---

### Ruby

文件类型：`*.rb`，注释符：`#`

三行注释放在 magic comment / shebang **之后**、`require` **之前**：

```ruby
# frozen_string_literal: true
# INPUT:  sinatra, json, ./models/user
# OUTPUT: API routes /users/**
# POS:    用户 API 路由定义
require 'sinatra'
```

---

### Lua

文件类型：`*.lua`，注释符：`--`

```lua
-- INPUT:  lfs, cjson
-- OUTPUT: Config table, load_config()
-- POS:    配置加载模块
local lfs = require("lfs")
```

---

### SQL

文件类型：`*.sql`，注释符：`--`

```sql
-- INPUT:  users table, orders table
-- OUTPUT: monthly_revenue view
-- POS:    月度营收统计视图
CREATE OR REPLACE VIEW monthly_revenue AS
```

---

## 编写指南

### INPUT — 写什么

列出 **直接依赖**，不列传递依赖。

| 写法 | 好/坏 | 原因 |
|------|-------|------|
| `embassy_nrf(twim, gpio)` | 好 | 具体到子模块 |
| `WouoUI.h, WouoUI_page.h` | 好 | C 头文件直接列出 |
| `(none)` | 好 | 无外部依赖时明确标注 |
| `(no_std core only)` | 好 | 只依赖语言核心 |
| `everything` | 坏 | 太笼统 |
| 列出全部传递依赖 | 坏 | 只列直接依赖 |

### OUTPUT — 写什么

列出 **公开接口**，不列内部私有实现。

| 写法 | 好/坏 | 原因 |
|------|-------|------|
| `pub run_display() async task` | 好 | 函数签名 |
| `BatteryStatus, BATTERY_STATUS watch` | 好 | 类型 + 全局实例 |
| `Firmware entry point (pre_init + rmk_keyboard)` | 好 | 描述性 |
| `various functions` | 坏 | 太模糊 |
| 列出私有函数 | 坏 | 只列公开接口 |

### POS — 写什么

**一句话**定位，不要两句。

| 写法 | 好/坏 | 原因 |
|------|-------|------|
| `OLED 显示主循环，30FPS 菜单 / 1FPS 首页` | 好 | 准确、具体 |
| `BLE 数据通道协议 crate，固件和主机共用` | 好 | 说明了谁在用 |
| `一个工具文件` | 坏 | 太模糊 |
| 两三句描述 | 坏 | 必须一句话 |

---

## 跳过的文件类型

不添加头部注释：

- 配置：`*.json`, `*.toml`（项目配置）, `*.yaml`（CI 配置）
- 文档：`*.md`, `*.txt`, `*.rst`
- 数据/资源：`*.csv`, 图片, 字体, 二进制
- 生成文件：`*.generated.*`, `*.pb.go`, `*.d.ts`
- Lock 文件：`Cargo.lock`, `package-lock.json`
- 测试夹具（fixtures）：纯数据文件

---

## 语言检测方法

init 时按以下方式检测项目使用的语言：

| 信号 | 语言 |
|------|------|
| `Cargo.toml` 或 `*.rs` | Rust |
| `*.c`, `*.h` | C |
| `*.cpp`, `*.hpp`, `*.cc` | C++ |
| `go.mod` 或 `*.go` | Go |
| `package.json` + `*.js` | JavaScript |
| `tsconfig.json` 或 `*.ts`, `*.tsx` | TypeScript |
| `*.py`, `pyproject.toml`, `setup.py` | Python |
| `*.swift`, `Package.swift` | Swift |
| `*.kt`, `build.gradle.kts` | Kotlin |
| `*.java`, `pom.xml`, `build.gradle` | Java |
| `pubspec.yaml` 或 `*.dart` | Dart |
| `*.sh`, `*.bash` | Shell |
| `Gemfile` 或 `*.rb` | Ruby |
| `*.lua` | Lua |
