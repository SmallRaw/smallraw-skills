# Smallraw Skills Collection

A collection of AI development skills compatible with [Claude Code](https://code.claude.com/) and [OpenCode](https://opencode.ai/).

---

## Installation

### Claude Code (Marketplace)

```bash
/plugin marketplace add smallraw/smallraw-skills
/plugin install rule-gardener@smallraw-skills
/plugin install fractal-docs@smallraw-skills
/plugin install excel-lite-cli@smallraw-skills
/plugin install openclaw-tmux-agent@smallraw-skills
/plugin install mcp-lazy-cli@smallraw-skills
/plugin install github-kb@smallraw-skills
/plugin install codex-delegate-worker@smallraw-skills
/plugin install guidelines-coding@smallraw-skills
/plugin install guidelines-git@smallraw-skills
/plugin install guidelines-security-local@smallraw-skills
/plugin install guidelines-security-npm@smallraw-skills
/plugin install guidelines-security-shell@smallraw-skills
/plugin install guardrails-agent-plugin@smallraw-skills
```

各 Skill 会按其 `SKILL.md` 中的触发条件自动生效；支持手动调用的 Skill 也可以通过对应的 `/skill-name` 命令使用。

### 安全护栏（guidelines-security-* / guidelines-git）

这四个 Skill 的规则写在确定性的 `scripts/policy.mjs` 里（输出 `allow` / `confirm` / `deny`），
SKILL.md 只保留少量无法从代码推导的约定，因此几乎不占用上下文。

**它们以 Hook 为准入前提：安装插件即自动注册 `PreToolUse` Hook，重启会话后生效。**
Hook 在模型之外强制执行，因此模型被提示注入说服时依然拦得住；模型也不会在对话里
重复确认 Hook 已经把关的操作。未注册 Hook 时，Skill 会先提出安装而不是继续执行受控操作。

| 门禁 | 覆盖范围 |
|------|----------|
| `guidelines-git` | Git 写操作、GitHub 写入、目录级 SSH 身份 |
| `guidelines-security-local` | `.env`、密钥、凭据存储、认证仓、环境变量转储、文件名伪装域名 |
| `guidelines-security-npm` | 依赖图变更、一次性包运行器、未审代码执行、发布 |
| `guidelines-security-shell` | 提权、越界删除与改权限、磁盘/设备操作、进程清扫、Shell 间接层 |

日常命令保持静默（`git status`、`npm test`、工作区内 `rm -rf node_modules`、`bash build.sh`、
`diskutil list` 等均直接放行）；危险操作按 `deny` / `confirm` 分级，并附带规则 ID 与补救建议。

其他 Agent（Codex、Cursor、Copilot、Pi、OpenCode 等）通过
[guardrails-agent-plugin](skills/guardrails-agent-plugin/) 复用同一份 policy，
由它按目标 Host 的官方 Hook 机制生成适配层。

### 手动安装

```bash
# Claude Code
mkdir -p ~/.claude/skills
git clone https://github.com/smallraw/smallraw-skills.git /tmp/smallraw-skills
cp -r /tmp/smallraw-skills/skills/rule-gardener ~/.claude/skills/

# OpenCode
mkdir -p ~/.config/opencode/skills
cp -r /tmp/smallraw-skills/skills/rule-gardener ~/.config/opencode/skills/
```

将示例中的 `rule-gardener` 换成你要安装的 Skill 名称。

---

## Available Skills

`Marketplace` 表示已在 `.claude-plugin/marketplace.json` 中注册；`Manual` 表示仓库已包含，但目前需要手动安装。

| Skill | Description | Installation |
|-------|-------------|--------------|
| [agent-farm-delegation](skills/agent-farm-delegation/) | 将范围明确的小任务委托给 ACPX、Pi、Codex 或本地 ACP worker | Manual |
| [app-analyzer](skills/app-analyzer/) | 分析和逆向 macOS `.app` 的技术栈、Bundle、资源与二进制 | Manual |
| [cc-setup](skills/cc-setup/) | 交互式配置 Claude Code 的 Skill 日志、HUD statusLine 等功能 | Manual |
| [codex-delegate-worker](skills/codex-delegate-worker/) | 通过配置好的自定义模型节点运行一次性 Codex worker | Marketplace |
| [excel-lite-cli](skills/excel-lite-cli/) | Excel 报表分析与数据清洗 - 处理复杂/乱序报表，自动清洗脏字符，查询/清洗/导出 | Marketplace |
| [fractal-docs](skills/fractal-docs/) | 分形文档协议 - 三层自描述文档体系，让 AI Agent 快速理解任意模块 | Marketplace |
| [github-kb](skills/github-kb/) | GitHub 知识库 — 搜索仓库/Issue/PR/代码，生成仓库蓝图（架构分析+设计亮点+线稿图） | Marketplace |
| [guardrails-agent-plugin](skills/guardrails-agent-plugin/) | 跨 Agent Hook 实现层 - 将领域 Skill 的规则、预检和阻断要求转换为原生 Hook | Marketplace |
| [guidelines-coding](skills/guidelines-coding/) | 编码行为准则 - 分阶段控制验证范围与频率 | Marketplace |
| [guidelines-git](skills/guidelines-git/) | Git 行为准则 - 保护现有状态、明确操作授权并使用仓库专属 SSH 身份 | Marketplace |
| [guidelines-security-local](skills/guidelines-security-local/) | 本地安全红线 - 禁止访问敏感数据并阻断文件名伪装域名 | Marketplace |
| [guidelines-security-npm](skills/guidelines-security-npm/) | npm 供应链安全准则 - 隔离审查依赖变更、执行与发布风险 | Marketplace |
| [guidelines-security-shell](skills/guidelines-security-shell/) | 破坏性 Shell 门禁 - 拦截提权、越界删除、磁盘操作与 Shell 间接层，工作区内清理零打扰 | Marketplace |
| [mcp-lazy-cli](skills/mcp-lazy-cli/) | MCP Skill System — 按需调用 MCP servers，不预加载，节省上下文 | Marketplace |
| [openclaw-tmux-agent](skills/openclaw-tmux-agent/) | 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作 | Marketplace |
| [rule-gardener](skills/rule-gardener/) | 项目规则园丁 - 培育项目规范有机生长 | Marketplace |
| [skill-writing-guide](skills/skill-writing-guide/) | 配合 skill-creator 使用的 Skill 编写约束与最佳实践 | Manual |

## CLI Packages

| Package | Binaries | Description |
|---------|----------|-------------|
| [fractal-context-cli](packages/fractal-context-cli/) | `fractal-context`, `fractal-context-cli` | Fractal docs-aware context reader: `status`, `list`, `read`, `search` |
| [mcp-client-utils](packages/mcp-client-utils/) | `mcp-client-utils` | Lazy MCP client: inspect the registry and connect, call, then disconnect on demand |

---

## Skills Overview

### /rule-gardener

**项目规则园丁** - 从问题和重复指令中培育项目规范有机生长。

核心理念：**规范是长出来的，不是设计出来的。**

Features:
- 问题识别：检测"应该引入规则"的信号
- 规则推荐：根据问题类型推荐合适的规则
- 规则植入：添加规则到 AGENTS.md
- 规则回顾：检查规则健康度

```bash
/rule-gardener init              # 初始化新项目
/rule-gardener problem "..."     # 识别问题并推荐规则
/rule-gardener extend workflow   # 添加流程规则包
/rule-gardener review            # 回顾规则健康度
```

### /fractal-docs

**分形文档协议** - 三层自描述文档体系，让 AI Agent 快速理解任意模块。

核心理念：**代码即文档，文档即协议。每一级目录自包含地描述自身。**

`/fractal-docs` 是维护层：创建、更新、检查协议文档。只读导航请使用 `fractal-context` CLI。

Features:
- 三行头部注释：每个源码文件的 INPUT/OUTPUT/POS
- 目录级 AGENTS.md：模块职责、逻辑、约束、业务域清单
- 级联更新：文件变更自动向上传播文档更新

```bash
/fractal-docs init     # 为项目建立完整文档体系
/fractal-docs update   # 文件变更后级联更新文档
/fractal-docs check    # 验证文档一致性

# 只读上下文导航
cd packages/fractal-context-cli
npm install
npm run build
node dist/index.js status --root /path/to/project
node dist/index.js list src --root /path/to/project --depth 2
node dist/index.js read src/foo.ts --root /path/to/project
node dist/index.js search wallet --root /path/to/project
```

### /excel-lite-cli

**Excel 报表分析与数据清洗** - 读取 Excel → 自动清洗脏字符 → 查询/清洗/加工 → 导出新文件。

专为弱模型和浅上下文优化：工具自动推荐配置、输出完整命令、校验规则格式。

Features:
- 自动侦察表结构并推荐配置（表头位置、序号列检测）
- 13 种内置清洗操作（trim, replace, filter, aggregate, pivot 等）
- steps 文件 schema 校验，写错参数精确报错
- 每一步输出带绝对路径的下一步命令，弱模型照抄即可
- 内置操作不够时，export 导出干净 csv 供自定义 Python 脚本处理

```bash
# 依赖：pip install openpyxl pandas
python scripts/excel_tool.py auto 报表.xlsx              # 自动侦察 + 推荐配置
python scripts/excel_tool.py auto 报表.xlsx headers       # 查看列名
python scripts/excel_tool.py auto 报表.xlsx query \
  --where-col "销量" --where-op ">" --where-val "100"     # 条件查询
python scripts/excel_tool.py clean 报表.xlsx --preview     # 预览清洗结果
python scripts/excel_tool.py clean 报表.xlsx -o out.xlsx   # 导出
python scripts/excel_tool.py help filter                   # 按需查看操作格式
```

### /mcp-lazy-cli

**MCP Skill System** — 像 skill 按需加载一样使用 MCP servers。

核心理念：**不预加载 = 不浪费上下文。registry 是索引，CLI 是执行器。**

Features:
- Registry 注册表：轻量索引描述项目可用的 MCP servers，AI 读一遍就知道有什么能力
- 按需连接：需要时连、用完就断，零常驻进程
- 全协议支持：tools / resources / prompts 完整 MCP 协议
- 三种传输：stdio（本地进程）、Streamable HTTP、SSE（legacy）
- npm 分发：`npx mcp-client-utils` 即用，只需 Node.js 20+

```bash
# 查看项目注册了哪些 MCP servers
npx mcp-client-utils --registry

# 按需调用
npx mcp-client-utils --server pencil tools
npx mcp-client-utils --server pencil call get_editor_state '{"include_schema":false}'
```

安装后在项目 `.claude/mcp-registry.json` 中注册你的 MCP servers：

```json
{
  "servers": {
    "my-server": {
      "description": "一句话说明",
      "when": "什么时候该用这个 server",
      "transport": { "type": "stdio", "target": "/path/to/server", "args": [] },
      "tools": [
        { "name": "tool_name", "description": "一句话概要" }
      ]
    }
  }
}
```

### github-kb

**GitHub 知识库** — 把 GitHub 当知识库，搜索、分析、总结、归档。

核心理念：**脚本采集确定性数据，AI 只做需要智能的分析。**

Features:
- 仓库蓝图：一键采集元信息/语言分布/目录结构/Releases/Issues/PRs/贡献者/同类项目，AI 补充架构分析和设计亮点
- Issue/PR 摘要：完整正文+评论+标签，PR 额外含变更文件和代码量统计
- 话题探索：多维度搜索（repos+issues+code+PRs），生成综合调研报告
- 叙事结构输出：先讲「为什么值得关注」，再讲「怎么实现的」，最后附原始数据
- 全中文输出，ASCII 线稿图可视化架构
- Node.js 脚本，跨平台（Windows/macOS/Linux）

```bash
# 依赖：gh CLI (>= 2.80.0) + Node.js
node scripts/gh-repo-blueprint.js owner/repo         # 生成仓库蓝图
node scripts/gh-digest.js issue owner/repo 123       # Issue 摘要
node scripts/gh-digest.js pr owner/repo 456          # PR 摘要
node scripts/gh-explore.js "mcp server" --language python  # 话题探索
```

输出保存到 `~/docs/github-article/`。

### openclaw-tmux-agent

**多 AI CLI 工具调度协议** - 通过 tmux 实现持久化的多 Agent 协作。

核心理念：**让任意 AI CLI 工具成为你的 Agent。**

Features:
- 三层架构：tmux 原语 → 状态持久化 → 生命周期管理
- 工具级持久化：session + 任务状态 + 健康检查/重启/回收
- Fire-and-forget：派发任务后异步收集结果
- 断线恢复：主控断开后通过状态文件 + pid 验证恢复调度

---

## Recommended Companion Tools

### Ralph - Autonomous Development Loop

如果你需要让 AI **自主循环开发**（自动提交、自动验证、自动修复），推荐使用 [Ralph](https://github.com/frankbria/ralph-claude-code)。

[Ralph Loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop)

**rule-gardener** 和 **Ralph** 是互补的：

| 工具 | 解决的问题 |
|------|-----------|
| **rule-gardener** | 规则该怎么写、何时加、如何演进 |
| **Ralph** | 循环该怎么跑、何时停止、失败如何处理 |

**Ralph 核心特性：**
- 熔断器机制（防止无限循环）
- 速率限制（防止 API 滥用）
- 双重退出验证（防止误报完成）
- Session 管理（跨循环保持上下文）

```bash
# 安装 Ralph
git clone https://github.com/frankbria/ralph-claude-code.git
cd ralph-claude-code && ./install.sh

# 在项目中启用
cd your-project
ralph-enable

# 启动自主开发循环
ralph
```

---

## Creating Your Own Skills

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on creating and contributing skills.

---

## License

MIT
