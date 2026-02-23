# /fractal-docs - 分形文档协议

三层自描述文档体系，让 AI Agent 快速理解任意模块。

## Quick Start

```bash
# 初始化：为项目建立完整文档体系
/fractal-docs init

# 更新：文件变更后级联更新文档
/fractal-docs update

# 检查：验证文档一致性
/fractal-docs check
```

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
