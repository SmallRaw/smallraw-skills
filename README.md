# Smallraw Skills Collection

A collection of AI development skills for Claude Code.

---

## Installation

### Claude Code

```bash
# Add marketplace (only once)
/plugin marketplace add smallraw/smallraw-skills

# Install a skill
/plugin install architect@smallraw-skills
```

### Manual Installation

```bash
# Clone to your skills directory
git clone https://github.com/smallraw/smallraw-skills.git ~/.claude/skills/smallraw-skills

# Or copy individual skills
cp -r smallraw-skills/skills/architect ~/.claude/skills/
```

---

## Available Skills

| Skill | Description | Status |
|-------|-------------|--------|
| [architect](skills/architect/) | AI Development Architect - 帮助建立和维护项目规范 | ✅ Ready |

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

---

## Creating Your Own Skills

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on creating and contributing skills.

---

## License

MIT
