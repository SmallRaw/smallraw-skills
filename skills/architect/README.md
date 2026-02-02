# Architect Skill

> AI 开发架构师 Skill - 帮助建立和维护项目规范

---

## 核心理念

**规范是长出来的，不是设计出来的。**

这个 Skill 来源于对 [OpenClaw](https://github.com/openclaw/openclaw) 项目的分析。该项目由 AI 主导开发，积累了 7000+ 次提交，形成了成熟的规范体系。

---

## 快速开始

### 1. 初始化新项目

复制 starter 文件到你的项目：

```bash
# 复制 AGENTS.md 模板
cp architect-skill/starter/AGENTS.starter.md your-project/AGENTS.md

# 复制 committer 脚本
mkdir -p your-project/scripts
cp architect-skill/starter/committer your-project/scripts/
chmod +x your-project/scripts/committer
```

### 2. 配置 Claude

创建 CLAUDE.md 软链接（让 Claude Code 自动加载规范）：

```bash
cd your-project
ln -s AGENTS.md CLAUDE.md
```

### 3. 按需扩展

当项目成长到需要更多规则时：

```bash
# 查看可用的扩展包
ls architect-skill/growth/

# 阅读扩展包，将需要的规则复制到 AGENTS.md
cat architect-skill/growth/level-1-quality.md
```

---

## 文件结构

```
architect-skill/
├── README.md               # 本文件
├── SKILL.md                # Skill 能力描述
├── knowledge/
│   ├── problem-rule-map.md # 问题-规则映射表
│   └── rule-templates.md   # 规则模板库
├── starter/
│   ├── AGENTS.starter.md   # 起始模板（10 条核心规则）
│   └── committer           # 安全提交脚本
└── growth/
    ├── level-1-quality.md  # 质量规则扩展包
    ├── level-2-workflow.md # 流程规则扩展包
    └── level-3-collab.md   # 协作规则扩展包
```

---

## 使用场景

### 场景 1：新项目

1. 复制 `starter/AGENTS.starter.md` 到项目根目录
2. 填写项目结构和命令
3. 随着开发逐步添加规则

### 场景 2：已有项目

1. 阅读 `knowledge/problem-rule-map.md`
2. 找到当前遇到的问题对应的规则
3. 将规则添加到项目的 AGENTS.md

### 场景 3：遇到重复问题

1. 问题第一次：记录到每日笔记
2. 问题第二次：查阅 `knowledge/problem-rule-map.md`
3. 找到对应规则，添加到 AGENTS.md

---

## 规则优先级

```
Level 0: 安全规则（第一天就加）
  ├── 禁止 git add .
  ├── 禁止编辑 node_modules
  └── 禁止提交敏感信息

Level 1: 质量规则（代码质量问题时加）
  ├── 测试规范
  ├── Lint 规范
  └── 代码风格

Level 2: 流程规则（有 PR/发布时加）
  ├── PR 工作流
  ├── Changelog 工作流
  └── 发布流程

Level 3: 协作规则（多 Agent 时加）
  ├── 禁止 git stash
  ├── 禁止切换分支
  └── Session 隔离
```

---

## 规则引入时机

```
问题第 1 次 → 记录
问题第 2 次 → 评估
              ├── 破坏性？ → 立即加规则
              ├── 协作相关？ → 立即加规则
              └── 效率问题？ → 可再观察
问题第 3 次 → 必须加规则
```

---

## 知识库

- `knowledge/problem-rule-map.md` - 问题到规则的映射
- `knowledge/rule-templates.md` - 规则的标准写法

当不知道该加什么规则时，查阅这些文件。

---

## 来源

这个 Skill 的知识来自对以下项目的分析：

- [OpenClaw](https://github.com/openclaw/openclaw) - 7000+ commits, AI 主导开发
- AGENTS.md 从 2 行增长到 179 行的演进历程

---

## License

MIT
