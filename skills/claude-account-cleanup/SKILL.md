---
name: claude-account-cleanup
description: 在 macOS 上完整审计、备份并彻底清理 Claude Code 与 Claude Desktop 的旧账户信息、登录凭据、本地身份 ID、缓存与遥测状态，防止新旧账号混用串号触发风控。当用户要求备份旧 Claude 账号、彻底清理 Claude 登录痕迹、重置或切换 Claude 账号、或排查是否存在旧账号残留以防封号时触发。不用于规避平台封禁或支付风控。
user-invocable: true
---

# Claude 旧账户备份与全量清理

在 macOS 上对 Claude Code 与 Claude Desktop 的账户态严格遵循 **「强制先 Dry-Run 出详细演练报告 → 用户审阅确认 → SHA-256 全量备份 → 执行清理并归档报告 → 外部防串号核查」** 的五步闭环，确保切换新账号前不遗漏任何旧账户缓存、凭据、身份标识或后台进程。

> **安全边界**：本 skill 仅用于备份用户本地配置并彻底清理本机残留的旧账户状态，防止新旧账号状态混杂（串号）。**不用于规避封禁、设备/IP 风控或支付验证。**

## 核心规则

1. **任何执行前必须先跑 `--dry-run` 并输出详细演练报告**。无论用户是要求检查还是直接要求“帮我清理”，Agent **第一步必须先运行 `--dry-run`**（只读零写盘），向用户完整呈现结构化的《Dry-Run 详细演练报告》，绝不能跳过 Dry-Run 直接让用户跑清理。
2. **正在 Claude Code 内运行时，绝不执行写操作清理**。在 Claude Code 会话内只能运行 `--dry-run`、`--audit`、`--list-backups` 或 `--backup-only`；实际清理必须由用户审阅 Dry-Run 报告、退出所有 Claude 进程后，在普通终端（Terminal / iTerm / Ghostty）或 Codex 中执行。
3. **先全量备份并 SHA-256 校验，再做任何改动**。正式清理的第一个写操作必定是将 `~/.claude`（或 `CLAUDE_CONFIG_DIR`）、`~/.claude.json`、`claude_desktop_config.json` 与所有待移除目标复制到 `~/ClaudeBackups/`（`0700` 权限），生成逐文件 `hashes.json`、`dry-run-report.md` 与 `report.json` 并校验可用磁盘空间。
4. **绝不读取或打印密钥明文**。审计、演练与备份全程只报告键名、路径、体积与存在状态，绝不读取或输出 Token、Keychain 密码、API Key 或邮箱明文。
5. **只进废纸篓，不自动杀进程，保护工作资产**。所有移除仅移入 `~/.Trash/claude-account-cleanup-<timestamp>/`；检测到活跃进程时要求用户手动退出并复检，绝不自动 `kill`；绝不删除 `projects`、`sessions`、`history.jsonl`、`skills`、`plugins`、`hooks`、`commands`、`agents`、`settings.json`、`CLAUDE.md`，且遥测关闭键逐值保持不变。

## 强制两阶段工作流

> 执行下方命令时，将 `scripts/claude_account_cleanup.py` 替换为本 Skill 所在目录的实际路径（例如 `~/.claude/skills/claude-account-cleanup/scripts/claude_account_cleanup.py`）。

### 第一阶段（必做）：执行 `--dry-run` 并输出《详细演练报告》

触发本 Skill 后，**立即在当前会话运行只读演练**（零写盘，无需退出 Claude）：

```bash
python3 scripts/claude_account_cleanup.py --dry-run
```

> 默认预览推荐的完整换号方案（`--desktop-mode 1`）；也可根据用户诉求附加 `--desktop-mode 0|1|2|3`、`--no-rotate`、`--no-creds`、`--no-deep` 演练不同组合。如需单独创建或查看备份快照，可运行 `--backup-only` 或 `--list-backups`。

拿到输出后，**必须向用户输出一份结构清晰的《Dry-Run 详细演练报告》**，包含以下 6 个模块，缺一不可：

1. **运行环境与活跃进程预检**：当前配置目录、在线 Claude 进程数与列表、已设置的环境变量、IDE Claude 扩展、`settings.json` / `settings.local.json` 遥测状态与当前时区。
2. **全量备份与空间预检**：备份目标目录、主配置目录文件数与体积、待移除目标合计体积、可用磁盘空间及余量校验结果。
3. **身份轮换与账号缓存键剥离明细**：逐个列出将被修改的配置文件（`~/.claude.json`、`~/.claude/.claude.json`、`backups/.claude.json.backup.*`、Desktop `config.json`）、执行动作（轮换 `userID`/`machineID` + 剥离键 vs 仅剥离键）以及将移除的键名列表。
4. **钥匙串与凭据清理明细**：将循环删除的 CLI Keychain（`Claude Code-credentials*`）、Desktop Keychain（`Claude Safe Storage` 等）及明文 `.credentials.json` 数量。
5. **待移入废纸篓逐项路径表**：完整列出每一项待移动路径的**序号、分类**（`安全缓存/遥测`、`CLI明文凭据`、`深层运行/设备记录`、`Desktop登录态`、`Desktop全量数据`）、**类型**（目录/文件/软链）、**体积**与**完整路径**。
6. **受保护资产核对清单**：明确列出本机已检出且受代码级门禁保护、绝不触碰的目录与文件。

输出报告后，请用户确认是否按此演练范围执行（或是否需要调整某个选项）。

### 第二阶段：用户确认报告后，在普通终端交互执行

用户审阅《Dry-Run 详细演练报告》并同意继续后，提醒用户：
1. 先正常退出 **Claude Desktop**、所有 **Claude Code** 终端标签页，以及挂着 Claude 扩展的 **VS Code / Cursor / Windsurf** 窗口（防止内存中的旧 OAuth Token 继续发请求导致串号）。
2. 在普通终端中运行交互式清理：

```bash
python3 scripts/claude_account_cleanup.py
```

- **不要用管道代答，不要绕过确认**。脚本依次确认 5 个选项：
  1. 轮换 `.claude.json` 全家族的 `userID` / `machineID` 并清除全部账号/令牌/实验缓存字段（同时清理 `.claude.json.tmp.*`）。
  2. 清理全部 CLI 凭据（循环删除 Keychain `Claude Code-credentials*` 并移除 `.credentials.json`）。
  3. 清理深层运行与设备记录（`daemon/`、`vercel-plugin-device-id`、`ant-did`、`ant-device-registry.json`、`debug/`、`ide/`、`session-env/`、`state/`）。
  4. Claude Desktop 档位：`0` 保留 / `1` 定向清登录态、Electron 存储、`Claude Safe Storage`、`cfprefsd` 与 `config.json(.journal)`（**保留会话与 `claude_desktop_config.json`**）/ `2` 全量清空桌面端（自动恢复 `claude_desktop_config.json`）/ `3` 再移除 `/Applications/Claude.app`。
  5. 若当前 macOS 时区不是 `Asia/Taipei`，询问是否修改（原生 `sudo` 隐藏提示输入密码）。
- 终端内会再次打印按用户所选参数生成的 **《Dry-Run 详细演练报告》**，用户输入一次 `CONFIRM` 后才开始写盘，并将 `dry-run-report.md`、`hashes.json`、`report.json` 归档至本次备份目录。

### 第三阶段：清理后执行报告与外部防串号核查

清理完成后，向用户汇总**备份快照路径**、**操作报告路径（`report.json` / `dry-run-report.md`）**、**废纸篓批次路径**，并提醒用户登录新账号前完成外部核查：

1. **网页端注销旧会话**：在旧账号网页端 `claude.ai` → Settings → Security 执行 **Log out of all devices**，并核查 **Trusted devices**。
2. **清理浏览器态（防误伤共享分区）**：按 [`references/browser-cleanup.md`](references/browser-cleanup.md) 精准清理 `claude.ai`、`claude.com`、`anthropic.com` 与扩展 `fcoeoabgfenejglbffodgkkbkcdhcgfn`，或使用全新浏览器 Profile，切勿误删 Persona / Cloudflare / hCaptcha 共享分区。
3. **环境变量与 IDE 扩展**：若有认证环境变量残留，自查 `~/.zshrc`、`~/.bashrc` 与 `settings.json`；重启装有 Claude 扩展的 IDE 并核对出口 IP 与时区一致性。

## Gotchas

1. **只删 Keychain 的 `Claude Code-credentials` 会漏掉两类致命残留**：SSH/tmux 等场景下会写入明文 `~/.claude/.credentials.json`；使用过 `CLAUDE_CONFIG_DIR` 时 Keychain 服务名为 `Claude Code-credentials-<sha256前8位>`，且同名 Keychain 条目可能存在多条。脚本已全覆盖并循环删除直到返回 44。
2. **只改 `~/.claude.json` 容易被自动备份、临时文件或桌面端 journal 回滚**：`~/.claude/backups/.claude.json.backup.*`、`~/.claude/.claude.json` 与桌面端 `config.json` 均存有旧账号字段；`config.json.journal` 会在桌面端重启时回放旧登录态，崩溃残留的 `~/.claude.json.tmp.*` 也必须一并移除。
3. **正在运行的 Claude 会话不会因为清理磁盘而立即切换**：`/login` 或删 Keychain 对已启动的 CLI 会话和后台 subagent 不会即时失效，旧 Token 在进程退出前仍可能继续请求接口。
4. **`daemon/`、`hud/` 与设备记录边界**：`~/.claude/daemon/control.key`、`daemon-auth-*`、`hud/usage-cache.json`、`hud/keychain-backoff` 会保存后台认证冷却与旧账户额度缓存；删除桌面端 `ant-did` / `ant-device-registry.json` 只清理本地记录，不能撤销服务端设备登记或重置 Secure Enclave 硬件密钥（`Q6L2SF6YDW.com.anthropic.claude.hwkey`）。
5. **浏览器与桌面端不要一刀切**：Chrome 里 Persona/Cloudflare 存储会与 ChatGPT 等其他站点共享分区，绝不能按关键词整库删；桌面端优先选模式 `1` 保留 `claude_desktop_config.json` 与 Code/Cowork 会话。

## 参考资料

| 文件 | 内容 | 何时读 |
|------|------|--------|
| [`references/account-footprint.md`](references/account-footprint.md) | 6 层全量痕迹清单、Keychain 规则、`.claude.json` / `config.json` 账号键明细、硬件密钥边界 | 需要向用户逐项解释某类文件为何清理/为何保留，或排查疑难残留时 |
| [`references/browser-cleanup.md`](references/browser-cleanup.md) | Chrome 等浏览器多 Profile 精准清理域名、扩展 ID 与共享分区防误伤规则 | 需要清理浏览器网页端或扩展登录态时 |
| [`scripts/claude_account_cleanup.py`](scripts/claude_account_cleanup.py) | 审计、Dry-Run 详细报告、SHA-256 备份、交互清理、废纸篓隔离与校验脚本 | 执行任何检查、演练、备份或清理前运行 |
