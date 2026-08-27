---
name: orca-computer-use
description: >-
  用 Orca 的 computer-use CLI 检查和操作本地桌面应用窗口：读取无障碍树、截图、执行安全的
  UI 动作。适用于列出应用/窗口、获取应用状态、读取可见 UI、点击控件、输入文字、按键、滚动、
  拖拽、设置值或执行无障碍动作。也适用于浏览器窗口、webview、Orca 自身界面等桌面 UI。
  触发词包括「computer use」「orca computer」「读一下 Spotify」「读 Slack」「点击/读取/操作
  某个桌面应用」「获取 app state」「操作桌面应用」「自动化点一下」。
  不适用于纯网页自动化（用 chrome-devtools）或 iOS/Android 应用。
user-invocable: false
disable-model-invocation: false
---

# Computer Use（Orca）

这个文件是**发现存根，不是使用指南**。完整的、与二进制版本对齐的 computer-use 参考由 `orca`
自己提供 —— 刻意不写进本文件，这样它永远不会和实际执行命令的那个二进制版本漂移。

需要检查或操作本地桌面应用窗口时使用 Orca 的 computer-use 能力：读取它的无障碍树、截图，
或执行安全的 UI 动作（点击控件、输入、按键、滚动、拖拽、设置值）。也覆盖浏览器窗口、
webview 和 Orca 自己的界面。

## 先为本次会话确定可执行文件

选定一次，后续所有命令复用同一个：

- 如果设置了 `ORCA_CLI_COMMAND` 环境变量，用它的值。Orca 在托管的 WSL 会话里会导出这个变量。
- 否则，在暴露了 `ORCA_DEV_REPO_ROOT` 的开发检出会话里，用 `orca-dev`。
- 否则，在 Orca 托管终端之外的 Linux 上，用 `orca-ide`。**绝不要在那里直接运行 `orca`** ——
  在 Orca 的终端之外，它通常解析到 GNOME Orca 屏幕阅读器（`/usr/bin/orca`），会在用户机器上
  开始朗读。
- 否则，用 `orca`。

下文的 `ORCA` 是你解析出的可执行文件的占位符。运行前替换它；不要创建 shell 变量，也不要
字面执行 `ORCA`。POSIX shell、PowerShell 和 cmd.exe 都一样。

如果选定的可执行文件无法运行，报告它的确切错误并停止。不要退而求其次换另一个 —— 那可能
悄悄指向一个不同的 Orca 构建。

## 运行 Orca 命令前先载入完整指南

```text
ORCA skills get computer-use
```

这会打印完整的、与即将处理你命令的那个二进制版本对齐的指南 —— 列出应用/窗口、读取 UI、
驱动点击输入和其他无障碍动作。**先读它**，再运行你需要的具体命令。

> 注意：这里的 `computer-use` 是 Orca 二进制自己的 skill id，不是本 skill 的名字，不要改成
> `orca-computer-use`，否则取不到指南。

不要凭记忆或凭本存根的缓存副本猜子命令和参数。它们在 Orca 版本之间会变，本文件也刻意不再
列举。用 `ORCA status --json` 确认应用已启动（需要时用 `ORCA open --json` 启动），
agent 驱动的调用优先加 `--json`。

## 如果旧版 Orca 不认识 `skills get`

**仅当**选定的二进制明确报告 `skills get` 是未知命令时才用这个兜底。其他失败不能作为
"这是旧版"的证据 —— 报告它，而不是猜测或换可执行文件。确认是前指南版本的二进制时，只用
下面这组有边界的只读命令来定位。不要走进死胡同，也不要编造命令：

```text
ORCA status --json
ORCA computer capabilities --json
ORCA computer list-apps --json
```

然后告诉用户：升级 Orca 就能通过 `ORCA skills get computer-use` 恢复完整的版本对齐指南。
除这几条之外，去问用户，而不是猜一个这个旧二进制可能不支持的命令面。

---

## 来源

vendor 自 [stablyai/orca](https://github.com/stablyai/orca)（MIT），
`skills/computer-use/SKILL.md`，上游最后改动 `1a9e819c40eb`（2026-07-22）。

本地改动仅两处，正文的命令契约保持原样：

1. `name` 改为 `orca-computer-use`，避免和其他 computer-use 类 skill 撞名。
2. description 改写为中文并补充中文触发词，正文译为中文 —— 触发和阅读都在中文语境下发生。

上游是薄存根、真正的指南由二进制提供，所以这份 vendor 副本**不需要跟着上游频繁同步**；
只有当"如何解析可执行文件"或"如何取指南"的机制变了才需要更新。
