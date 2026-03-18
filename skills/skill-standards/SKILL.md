---
name: skill-standards
description: "Enhancement layer for skill-creator. Triggers alongside skill-creator when creating, editing, or reviewing skills. Adds structural standards (core rules + gotchas + progressive disclosure) and isolated testing methodology. Does NOT replace skill-creator — it adds constraints on top of it."
user-invocable: false
disable-model-invocation: false
---

# Skill 质量标准

skill-creator 的增强层。创建或改进 skill 时，在 skill-creator 的流程基础上额外执行以下约束。

## SKILL.md 结构约束

每个 SKILL.md 必须包含以下结构，缺一不可：

```
SKILL.md
  frontmatter
    description     ← 清晰的触发描述，写给模型看，稍微"pushy"一点
  一句话介绍
  核心规则 (3-8条)   ← 推动模型偏离默认行为的关键指令
  Gotchas (5-10条)  ← 最高信号内容：真实失败模式积累的避坑清单
  极简用法速查       ← 可选，模型可能不熟悉的 CLI/API 才需要
  指向 references/  ← 详细内容下沉，SKILL.md 只做索引
```

**为什么这样做**：SKILL.md 在 skill 触发时全量加载到上下文。内容越精炼，模型越能抓住重点。详细的参考资料、模板、示例放在 references/ 里按需读取，不浪费 token。

**Gotchas 是最重要的部分**。这些不是理论推测，而是从实际使用中积累的失败模式——模型反复犯的错、用户反复踩的坑。每条 gotcha 应该说清楚"错在哪"和"怎么避免"。新建的 skill 可能还没有 gotchas，留空占位，随着使用逐步补充。

**Don't State the Obvious**：模型已经知道的东西不要写进 SKILL.md。只写能把模型推出默认行为的信息。

## 测试方法论

测试 skill 时，必须在**隔离的子项目**中进行，不要在当前工作项目里跑。

**为什么**：当前项目有大量上下文噪音（已有文件、git 历史、CLAUDE.md 规则），会干扰对 skill 效果的判断。隔离环境能直达病灶，更清楚地看到 skill 本身的表现。

**做法**：

1. 创建一个干净的临时目录作为测试项目
2. 只放测试所需的最小文件（如果 skill 需要操作文件的话）
3. 在这个隔离环境中用 skill-creator 的 eval 流程跑测试用例
4. 对比 with-skill vs without-skill 的输出差异

这样能排除环境因素，精准评估 skill 的增量价值。
