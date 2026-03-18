---
name: skill-writing-guide
description: "TRIGGER with skill-creator when creating, editing, or reviewing skills. Adds structural constraints — not a replacement, an add-on."
user-invocable: false
disable-model-invocation: false
---

# Skill 质量标准

skill-creator 的增强层。创建或改进 skill 时，额外执行以下约束。

## SKILL.md 结构

```
SKILL.md
  description        ← 触发条件，不是功能摘要
  一句话介绍
  核心规则 (3-8条)    ← 推动模型偏离默认行为的关键指令
  Gotchas (5-10条)   ← 真实失败模式积累的避坑清单
  极简用法速查        ← 模型可能不熟悉的 CLI/API 才需要，否则省略
  指向 references/   ← 详细内容下沉，SKILL.md 只做索引
```

## 核心规则

1. **Gotchas 是最高信号内容**。从实际使用中积累，每条说清"错在哪"和"怎么避免"。新 skill 还没有 gotchas 时留空占位，随使用补充
2. **Don't State the Obvious**。模型已经知道的不要写。只写能把模型推出默认行为的信息
3. **渐进披露**。SKILL.md 触发时全量加载，保持精炼。参考资料、模板、示例放 references/ 按需读取
