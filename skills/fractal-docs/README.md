# /fractal-docs - 分形文档协议

三层自描述文档体系，让 AI Agent 快速理解任意模块。

`/fractal-docs` 是维护层，负责创建、更新、检查协议文档。只读导航和代码理解辅助使用 companion CLI：`fractal-context`。

## Quick Start

```bash
# 初始化：为项目建立完整文档体系
/fractal-docs init

# 更新：文件变更后级联更新文档
/fractal-docs update

# 检查：验证文档一致性
/fractal-docs check
```

## 只读上下文导航

项目已经建立分形文档后，可以用 `fractal-context` 让 agent 先按文档理解代码，再决定读取哪些源码：

```bash
fractal-context status
fractal-context list src --depth 2
fractal-context read src/wallet.ts
fractal-context search wallet
```

`fractal-context` 只读取 `FRACTAL-DOCS.md`、目录 `AGENTS.md` 和源码 INPUT/OUTPUT/POS 头注释，不会修改项目文件。

## 三层结构

```
Layer 1  源码文件       // INPUT: / OUTPUT: / POS:  三行头注释
Layer 2  目录 AGENTS.md  # 模块名 > 地位 > 逻辑 > 约束 > 业务域清单
Layer 3  级联规则        新增/删除/修改 → 自动向上传播
```

## 效果

Agent 进入任意目录，3 秒内理解：
- 这个文件依赖什么、对外暴露什么、在系统中的角色
- 这个目录的模块职责、内部分工、技术约束
- 整个项目的模块拓扑

## 安装

```bash
# Claude Code
mkdir -p ~/.claude/skills
cp -r skills/fractal-docs ~/.claude/skills/
```
