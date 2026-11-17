# Claude Code & Claude Desktop 本机账户痕迹全量清单（macOS）

本文档按 6 个层级拆解 Claude Code 与 Claude Desktop 在 macOS 上的全部账户、凭据、身份、缓存与遥测落盘位置，明确区分**自动清理**、**风险选择**与**绝对保护**三类策略。

---

## 第 1 层：活跃进程与环境变量（防内存串号）

| 检查项 | 为什么不能漏 | 处理方式 |
|---|---|---|
| CLI / App 进程（`claude`、`claude-code`、`Claude.app`、`Claude Helper*`、daemon） | 已启动的 CLI 会话或后台 subagent 会把 OAuth Token 缓存在内存中，磁盘删干净后旧进程仍会继续向接口发请求，导致新旧账号交叉计费/串号 | 审计列出进程；选择风险清理时要求用户手动正常退出并按 Enter 复检，绝不自动 `kill` |
| IDE 扩展进程 / 安装目录（`~/.vscode/extensions/*anthropic*`、`~/.cursor/extensions/*anthropic*` 等） | VS Code / Cursor 扩展会持有自己的 Claude 侧边栏登录会话或子进程 | 审计提示已安装的扩展，提醒重启 IDE 并在扩展内重新登录 |
| 环境变量（`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`） | shell profile 或启动参数里的 Token 会静默覆盖 Keychain 登录态 | 审计仅报告「已设置/未设置」（**绝不读取或打印值**），提醒用户自查 `~/.zshrc` / `~/.bashrc` |

> 若设置了 `CLAUDE_CONFIG_DIR`，CLI 会把配置目录从 `~/.claude` 整个切换到该路径，`.claude.json` 与 `.credentials.json` 也跟着过去；审计与备份脚本同时覆盖当前生效目录与默认 `~/.claude`。

---

## 第 2 层：认证凭据与 macOS 钥匙串

| 目标 | 说明 | 策略 |
|---|---|---|
| Keychain `Claude Code-credentials` | 默认 `~/.claude` 的 OAuth `accessToken` / `refreshToken` | 风险项 `[2]`：循环 `security delete-generic-password` 直到返回 44（防同名多条目残留） |
| Keychain `Claude Code-credentials-<sha256前8位>` | 设置 `CLAUDE_CONFIG_DIR` 时 Claude Code 使用的哈希服务名 | 同上，脚本按实际 `CLAUDE_CONFIG_DIR` 计算哈希并清理 |
| `~/.claude/.credentials.json`（及 `${CLAUDE_CONFIG_DIR}/.credentials.json`） | SSH / tmux / Keychain 不可用时的明文回退凭据（`0600`） | 风险项 `[2]`：移入废纸篓 |
| Keychain `Claude Safe Storage` / `Claude Key` / `com.anthropic.claudefordesktop` | Claude Desktop Electron `safeStorage` 的主加密密钥 | 随 Desktop 清理选项 `[1/2/3]` 循环清理 |
| macOS Internet Password（`claude.ai`、`console.anthropic.com`、`platform.claude.com`） | Safari 或系统自动保存的网页凭据 | 审计检测是否存在（不读取密码），提醒用户在钥匙串访问或浏览器中核查 |

---

## 第 3 层：全局状态与本地身份文件（`.claude.json` 全家族）

检查以下全部文件（脚本支持同步更新，且永不打印值）：
- `~/.claude.json`（或 `${CLAUDE_CONFIG_DIR}/.claude.json`）
- `~/.claude/.claude.json`（部分版本/配置曾写入配置目录内部）
- `~/.claude/backups/.claude.json.backup.*`（旧自动备份若不清理或同步，可能回滚出旧账号字段）
- `~/.claude.json.tmp.*`（崩溃残留的原子写临时文件 → 纳入自动安全清理，移入废纸篓）

### 轮换与清除字段明细（风险项 `[1]`，桌面端 `config.json` 同步适用）

- **重新生成 64 位十六进制随机 ID**（仅 CLI `.claude.json` 家族）：`userID`、`machineID`（主文件与所有 `.claude.json.backup.*` 保持同一组新值）。
- **清除已知账号 / 组织 / 令牌 / 引导 / 远程实验缓存键**（CLI `.claude.json` 与桌面端 `~/Library/Application Support/Claude/config.json`）：
  - 账号与令牌：`oauthAccount`（含 `accountUuid`、`organizationUuid`、`emailAddress` 等）、`accountUuid`、`lastKnownAccountUuid`、`oauth:tokenCache`、`oauth:tokenCacheV2`、`anonymousId`、`claudeCodeFirstTokenDate`、`firstStartTime`、`penguinModeOrgEnabled`、`isQualifiedForDataSharing`、`hasAcknowledgedCostThreshold`、`subscriptionNoticeCount`、`customApiKeyResponses`、`fallbackAvailableWarningThreshold`
  - 远端特性与额度缓存：`additionalModelCostsCache`、`additionalModelOptionsCache`、`autoCompactWindowsCache`、`cachedChromeExtensionInstalled`、`cachedDynamicConfigs`、`cachedExperimentData`、`cachedExperimentFeatures`、`cachedExtraUsageDisabledReason`、`cachedGrowthBookFeatures`、`cachedGrowthBookFeaturesAt`、`cachedRateLimitTier`、`cachedStatsigGates`、`clientDataCache`、`clientDataCacheSlots`、`feedbackSurveyState`、`groveConfigCache`、`metricsStatusCache`、`modelAccessCache`、`orgModelDefaultCache`、`passesEligibilityCache`、`s1mAccessCache`、`s1mNonSubscriberAccessCache`、`tenancyCache`
  - 动态兜底匹配：任何顶层键以 `cached` 开头或以 `AccessCache` / `CostsCache` / `OptionsCache` / `DefaultCache` 结尾的缓存字段。
- **桌面端事务日志**：`~/Library/Application Support/Claude/config.json.journal` 必须一并移入废纸篓，防止桌面端重启时通过 journal 回放恢复旧登录态。
- **保留不动**：用户配置的 `mcpServers`、`projects`（项目信任与本地工具授权）、编辑器习惯等非账号状态。

---

## 第 4 层：`~/.claude/` 下可再生缓存、遥测与运行态

### 4A. 自动安全清理（当没有 Claude 进程运行时自动纳入，移入废纸篓）

- `~/.claude/cache`（含 `changelog.md`、`model-catalog`、`my-closed-issues.json`）
- `~/.claude/stats-cache.json`
- `~/.claude/telemetry`（含 1P 遥测与失败重传队列，可能携带旧 `userID`/`accountUuid`）
- `~/.claude/usage.jsonl`、`~/.claude/usage.with-fix.jsonl`
- `~/.claude/remote-settings.json`（远端组织下发的设置缓存）
- `~/.claude/daemon-auth-cooldown`、`~/.claude/daemon-auth-status.json`、`~/.claude/daemon.log`（后台守护进程认证冷却与状态）
- `~/.claude/hud/usage-cache.json`、`~/.claude/hud/usage-last-fetch`、`~/.claude/hud/keychain-backoff`、`~/.claude/hud/sessions`（旧账户用量缓存与退避状态；保留 `hud-config.json`）
- `~/.claude/gh-pr-status-cache.json`
- `~/.claude/.last-cleanup`、`~/.claude/.last-update-result.json`
- `~/.claude/paste-cache`、`~/.claude/shell-snapshots`、`~/.claude/feedback`
- `~/.cache/claude-cli-nodejs`、`~/Library/Caches/claude-cli-nodejs`
- `~/Library/Logs/Claude`、`~/Library/Logs/DiagnosticReports/Claude*`、`~/Library/Application Support/CrashReporter/Claude*`
- `~/Library/Caches/com.anthropic.claudefordesktop*`（含 `.ShipIt` 更新缓存）
- `~/Library/Application Support/Claude/` 下纯可再生图形/崩溃/探测缓存：`Cache`、`Code Cache`、`GPUCache`、`DawnCache`、`DawnGraphiteCache`、`DawnWebGPUCache`、`GPUPersistentCache`、`GraphiteDawnCache`、`Crashpad`、`sentry`、`window-state.json`、`vm-support-probe.json`

### 4B. 深层运行与设备记录（风险项 `[3]`，由用户选择）

- `~/.claude/daemon`（含 `control.key`、`roster.json`、`attach-journal`、`dispatch` — 后台远程控制守护进程密钥与注册状态）
- `~/.claude/vercel-plugin-device-id`（如存在，插件生成的设备标识）
- `~/Library/Application Support/Claude/ant-did`、`ant-device-registry.json`（桌面端本地设备 ID 与按账号索引的公钥指纹/服务端设备记录）
  > **边界说明**：删除本地 `ant-did` 与 `ant-device-registry.json` 仅清理本地文件；若曾使用官方设备绑定（Secure Enclave 访问组 `Q6L2SF6YDW.com.anthropic.claude.hwkey`），本地清理**不等同于撤销服务端设备登记或更换硬件底层密钥**（读取受保护钥匙串访问组返回 `-34018` 表示无读取权限，不代表密钥不存在）。
- `~/.claude/debug`（CLI 调试日志，可能包含旧账户/请求头信息）
- `~/.claude/ide`、`~/.claude/session-env`、`~/.claude/state`

### 4C. 绝对保护清单（代码白名单强校验，绝不删除或移动）

`CLAUDE.md`、`agents`、`backups`、`channels`、`commands`、`file-history`、`history.jsonl`、`hooks`、`hud-config.json`、`keybindings.json`、`mcp-servers`、`plans`、`plugins`、`projects`、`rules`、`scheduled-tasks`、`scripts`、`sessions`、`settings.json`、`settings.local.json`、`skills`、`statusline-command.sh`、`tasks`、`teams`、`todos`、`usage-data`（`/insights` 报告）。

---

## 第 5 层：Claude Desktop（Electron）完整足迹

- **模式 `1`（定向清登录态，保留会话与 MCP 配置）**：
  - 剥离 `~/Library/Application Support/Claude/config.json` 的账号/令牌键，并将 `config.json.journal`、`ant-did`、`ant-device-registry.json` 移入废纸篓；
  - 仅清理 Electron 认证与 Web 存储：`Cookies*`、`Local Storage`、`Session Storage`、`IndexedDB`、`WebStorage`、`Network`、`Network Persistent State`、`TransportSecurity`、`Trust Tokens*`、`DIPS*`、`SharedStorage*`、`QuotaManager*`、`Service Worker`、`blob_storage`、`Session`/`Sessions`、`Preferences`、`Local State`、`Partitions`；
  - 同时清理系统级 `HTTPStorages`、`Preferences/*.plist`（附带 `defaults delete com.anthropic.claudefordesktop` 刷新 `cfprefsd`）、`ByHost/*.plist`、`Saved Application State`、`WebKit`、`Cookies`、`Group Containers`、`Containers` 与 Keychain `Claude Safe Storage`；
  - **保留** `claude_desktop_config.json`、`claude-code-sessions`、`local-agent-mode-sessions`、`scratch-workspaces`、`vm_bundles`。
- **模式 `2` / `3`（全量清理桌面端）**：
  - 将 `~/Library/Application Support/Claude` 整目录及相关系统位置一并移入废纸篓；模式 `2` 自动从备份恢复 `claude_desktop_config.json`（MCP 配置），模式 `3` 额外移除 `/Applications/Claude.app`。

---

## 第 6 层：外部防串号核查清单（人工完成）

1. 在旧账号网页端 `claude.ai` → Settings → Security 点击 **Log out of all devices**，并核查 **Trusted devices**。
2. 按 [`references/browser-cleanup.md`](browser-cleanup.md) 清理浏览器中 `claude.ai`、`claude.com`、`anthropic.com` 与扩展 `fcoeoabgfenejglbffodgkkbkcdhcgfn` 的站点数据，或开独立浏览器 Profile（切勿误删 Persona / Cloudflare 共享分区）。
3. 如审计发现 shell 环境或 `settings.json` / `settings.local.json` 中存在 `CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`，确认其中没有遗留旧账号凭据。
4. 重启装有 Anthropic Claude 扩展的 IDE（VS Code / Cursor / Windsurf）。
5. 核对出口 IP / 代理线路与 macOS 时区一致性，避免高频跨区/多号混登。
6. **验收提醒**：在应用关闭状态下复查；不要为了“测试是否干净”而重新登录或触发硬件密钥接口（启动即会重建本地文件）。
