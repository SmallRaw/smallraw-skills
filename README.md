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
```

安装后使用 `/rule-gardener:rule-gardener`、`/fractal-docs`、`/excel-lite-cli`、`/mcp-lazy-cli` 调用。

### 手动安装

```bash
# Claude Code
mkdir -p ~/.claude/skills
git clone https://github.com/smallraw/smallraw-skills.git /tmp/smallraw-skills
cp -r /tmp/smallraw-skills/skills/rule-gardener ~/.claude/skills/
cp -r /tmp/smallraw-skills/skills/fractal-docs ~/.claude/skills/
cp -r /tmp/smallraw-skills/skills/excel-lite-cli ~/.claude/skills/
cp -r /tmp/smallraw-skills/skills/openclaw-tmux-agent ~/.claude/skills/
cp -r /tmp/smallraw-skills/skills/mcp-lazy-cli ~/.claude/skills/

# OpenCode
mkdir -p ~/.config/opencode/skills
cp -r /tmp/smallraw-skills/skills/rule-gardener ~/.config/opencode/skills/
cp -r /tmp/smallraw-skills/skills/fractal-docs ~/.config/opencode/skills/
cp -r /tmp/smallraw-skills/skills/excel-lite-cli ~/.config/opencode/skills/
cp -r /tmp/smallraw-skills/skills/openclaw-tmux-agent ~/.config/opencode/skills/
cp -r /tmp/smallraw-skills/skills/mcp-lazy-cli ~/.config/opencode/skills/
```

手动安装后使用 `/rule-gardener` 调用。

---

## Available Skills

| Skill | Description | Status |
|-------|-------------|--------|
| [rule-gardener](skills/rule-gardener/) | 项目规则园丁 - 培育项目规范有机生长 | ✅ Ready |
| [fractal-docs](skills/fractal-docs/) | 分形文档协议 - 三层自描述文档体系，让 AI Agent 快速理解任意模块 | ✅ Ready |
| [excel-lite-cli](skills/excel-lite-cli/) | Excel 报表分析与数据清洗 - 处理复杂/乱序报表，自动清洗脏字符，查询/清洗/导出 | ✅ Ready |
| [openclaw-tmux-agent](skills/openclaw-tmux-agent/) | 通过 tmux 调度多个 AI CLI 工具实例，实现持久化的多 Agent 协作 | ✅ Ready |
| [mcp-lazy-cli](skills/mcp-lazy-cli/) | MCP Skill System — 按需调用 MCP servers，不预加载，节省上下文 | ✅ Ready |

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

Features:
- 三行头部注释：每个源码文件的 INPUT/OUTPUT/POS
- 目录级 AGENTS.md：模块职责、逻辑、约束、业务域清单
- 级联更新：文件变更自动向上传播文档更新

```bash
/fractal-docs init     # 为项目建立完整文档体系
/fractal-docs update   # 文件变更后级联更新文档
/fractal-docs check    # 验证文档一致性
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
- npm 分发：`npx mcp-client-utils` 即用，只需 Node.js

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
