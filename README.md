# Smallraw Skills Collection

A collection of AI development skills compatible with [Claude Code](https://code.claude.com/) and [OpenCode](https://opencode.ai/).

---

## Installation

### Claude Code (Marketplace)

```bash
/plugin marketplace add smallraw/smallraw-skills
/plugin install architect@smallraw-skills
/plugin install fractal-docs@smallraw-skills
```

安装后使用 `/architect:architect` 或 `/fractal-docs` 调用。

### 手动安装

```bash
# Claude Code
mkdir -p ~/.claude/skills
git clone https://github.com/smallraw/smallraw-skills.git /tmp/smallraw-skills
cp -r /tmp/smallraw-skills/skills/architect ~/.claude/skills/
cp -r /tmp/smallraw-skills/skills/fractal-docs ~/.claude/skills/

# OpenCode
mkdir -p ~/.config/opencode/skills
cp -r /tmp/smallraw-skills/skills/architect ~/.config/opencode/skills/
cp -r /tmp/smallraw-skills/skills/fractal-docs ~/.config/opencode/skills/
```

手动安装后使用 `/architect` 调用。

---

## Available Skills

| Skill | Description | Status |
|-------|-------------|--------|
| [architect](skills/architect/) | AI Development Architect - 帮助建立和维护项目规范 | ✅ Ready |
| [fractal-docs](skills/fractal-docs/) | 分形文档协议 - 三层自描述文档体系，让 AI Agent 快速理解任意模块 | ✅ Ready |

---

## Skills Overview

### /architect

**AI 开发架构师** - 帮助 AI 和人类建立、维护项目规范。

核心理念：**规范是长出来的，不是设计出来的。**

Features:
- 问题识别：检测"应该引入规则"的信号
- 规则推荐：根据问题类型推荐合适的规则
- 规则植入：添加规则到 AGENTS.md
- 规则回顾：检查规则健康度

```bash
/architect init              # 初始化新项目
/architect problem "..."     # 识别问题并推荐规则
/architect extend workflow   # 添加流程规则包
/architect review            # 回顾规则健康度
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

---

## Recommended Companion Tools

### Ralph - Autonomous Development Loop

如果你需要让 AI **自主循环开发**（自动提交、自动验证、自动修复），推荐使用 [Ralph](https://github.com/frankbria/ralph-claude-code)。

[Ralph Loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop)

**architect-skill** 和 **Ralph** 是互补的：

| 工具 | 解决的问题 |
|------|-----------|
| **architect-skill** | 规则该怎么写、何时加、如何演进 |
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
