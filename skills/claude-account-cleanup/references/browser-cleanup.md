# 浏览器（Chrome 等）定向清理指南

> Python 清理脚本不直接读写浏览器 SQLite / LevelDB 文件，避免并发锁冲突或误删共享数据库。本步骤由用户在浏览器原生设置中执行，或按下列规则逐资料核查。

## 目标域名与扩展

- **Web 登录态与站点数据**：`claude.ai`、`claude.com`、`anthropic.com`（含 `console.anthropic.com`、`platform.claude.com`）及其子域。
- **已知 Claude 浏览器扩展 ID 示例**：`fcoeoabgfenejglbffodgkkbkcdhcgfn`（操作前先在浏览器扩展页核对当前名称与 ID；清理存储不等同于停用/卸载）。

## 严禁误伤的红线

1. **禁止按字符串包含 `claude` 全库扫删**：会误伤包含 `claude` 字样的 GitHub 仓库书签、技术文档历史或其他工具记录。
2. **禁止直接整库删除浏览器存储目录**：不要整目录删除 `Cookies`、`Local Storage`、`Session Storage`、`IndexedDB`、`QuotaManager` 或 `Service Worker`。
3. **警惕第三方共享分区（Persona / Cloudflare / hCaptcha）**：
   - 身份核验与人机验证域名（如 `withpersona.com`、Cloudflare、hCaptcha）同时服务 ChatGPT、Kraken 等多个网站。
   - **必须按顶层站点 / storage key 分区清理**，不能看到 `withpersona.com` 就整站删除，以免破坏其他平台的验证状态。

## 推荐操作流程

1. 正常关闭所有 `claude.ai` / `console.anthropic.com` 标签页。
2. 逐个浏览器 Profile（`Default`、`Profile 1`...）检查：
   - Chrome 设置 → **隐私和安全** → **第三方 Cookie / 网站数据** → 搜索并仅清除 `claude.ai`、`claude.com`、`anthropic.com` 的站点数据。
3. 如使用离线只读巡检（仅限技术排查）：
   - 读取 SQLite 必须使用 `mode=ro`；遇到数据库锁立即停止，不要强读或删除锁文件；绝不输出 Cookie 值，只核对域名、键名和条目数量。
   - LevelDB 必须按 origin/storage key 精确清理并核对其他站点数据未被改动；无法确认 schema 时标记未完成。
4. 切新账号登录时，建议直接新建独立的浏览器 Profile，从根本上隔离旧号 Cookie、指纹与扩展存储。
