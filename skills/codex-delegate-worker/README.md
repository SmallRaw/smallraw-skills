# Codex Delegate Worker

使用配置好的模型节点运行 Codex，沿用原生配置、权限、MCP、skills 和会话保存。

## 配置和管理

让 AI 打开配置窗口，或执行：

```bash
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs init
```

用户在独立终端中添加、编辑、删除节点、设置默认节点，输入地址、模型和 Key。支持 Local／Global，Local 优先；删除 Local 默认节点后回退到 Global。

Key 不回显，私密配置由程序保存在 Codex 用户目录下的私有文件中，Local／Global 配置只放引用。新配置不依赖钥匙串或 Secret Service。AI 只接收配置状态，任务输出过滤已配置的私密值。

## 使用原生 Codex

```bash
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs open
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs "任务描述"
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs -- exec resume --last
```

`open` 在独立终端打开正常 Codex；已有终端或 SSH 中可用 `interactive` 直接运行。其后的参数交给原生交互 CLI。`--` 后的参数直接交给 Codex，支持 resume、fork、review、profiles 等原生功能。只传任务时使用 `codex exec`，自动跳过 Git 仓库检查。

不再建立临时 `CODEX_HOME`，不强制 `--ephemeral`，不覆盖沙箱或审批设置，也不删除会话。

原生 `codex exec` 未配置权限时默认只读。写入任务可传 `--sandbox workspace-write`；权限配置或用户显式传入的参数由 Codex 处理。

`status` 只返回配置是否存在；`configure` 可在用户自己的终端中管理配置。无需认证的节点可将 Key 留空。
