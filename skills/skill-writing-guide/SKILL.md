---
name: skill-writing-guide
description: "TRIGGER with skill-creator when creating, editing, or reviewing skills. Adds structural constraints and Anthropic's best practices — not a replacement, an add-on."
user-invocable: false
disable-model-invocation: false
---

# Skill 写作指南

基于 Anthropic 内部数百个 skill 的实战经验，覆盖"写什么"、"怎么写"、"怎么发"三个阶段。

## 核心规则

1. **Skill 是文件夹，不是单个 markdown**。把整个文件系统当作上下文工程的手段——脚本、模板、数据、引用文件都可以放进来，模型会在需要时读取
2. **Description 是触发条件，不是功能摘要**。模型启动时扫描所有 skill 的 description 来决定"这个请求要不要用这个 skill"，所以要写清楚 *什么时候触发*，而不是 *这个 skill 能干什么*
3. **Don't State the Obvious**。模型已经知道的不要写。只写能把模型推出默认行为的信息——比如你们内部库的 edge case，而不是"注意代码质量"
4. **Gotchas 是最高信号内容**。从实际使用中积累，每条说清"错在哪"和"怎么避免"。新 skill 还没有 gotchas 时留空占位，随使用补充
5. **渐进披露（Progressive Disclosure）**。SKILL.md 触发时全量加载，保持精炼；详细的函数签名、用法示例、完整 CLI 参考放 `references/`，模板放 `assets/`，脚本放 `scripts/`——SKILL.md 只做索引，告诉模型什么时候去读哪个文件
6. **别把指令写太死（Avoid Railroading）**。给模型需要的信息，但留灵活空间。因为 skill 会被反复复用，过于具体的指令会在某些场景下适得其反
7. **想清楚 Setup**。如果 skill 需要用户输入（如 Slack channel、API key），用 `config.json` 存配置；未配置时让模型主动询问，而不是静默失败
8. **给模型代码而不是让它重写**。提供可组合的脚本和函数库（放 `scripts/`），让模型把 token 花在编排逻辑上，而不是重复生成样板代码

## SKILL.md 结构模板

```
SKILL.md
  frontmatter            ← name, description(触发条件), user-invocable, etc.
  一句话介绍
  核心规则 (3-8条)        ← 推动模型偏离默认行为的关键指令
  Gotchas (5-10条)       ← 真实失败模式积累的避坑清单
  极简用法速查            ← 模型可能不熟悉的 CLI/API 才需要，否则省略
  参考资料索引            ← 指向 references/、scripts/ 等，标明"什么时候读"
```

## Gotchas

1. **Description 写成了功能介绍** — 写"User mentions any Excel file"而不是"Excel report analysis tool"。前者让模型知道何时触发，后者只是自我描述
2. **把模型已知的常识写进去** — "注意安全"、"写好测试"这类不需要写。只写你们特有的、模型猜不到的约束
3. **SKILL.md 塞太多内容** — 详细参考放 `references/`，SKILL.md 膨胀会浪费 context window
4. **指令过于死板** — "必须用 Jest + React Testing Library 写 3 个测试"在某些场景不适用。改为"确保有测试覆盖"+ 在 references 里给示例
5. **忘记 Gotchas 占位** — 新 skill 没有 gotchas 很正常，但要留空节方便后续补充，否则后续维护者容易忽略这个重要环节
6. **数据存在 skill 目录里** — 升级 skill 时目录内容可能被清除。持久化数据应存到 `${CLAUDE_PLUGIN_DATA}`
7. **Skill 间依赖未声明** — 如果你的 skill 引用了另一个 skill，在文档中明确说明，避免用户未安装时静默失败
8. **On-Demand Hooks 全局化** — `/careful`（阻止危险命令）、`/freeze`（锁定目录）这类 hook 应该按需激活而不是永久开启，否则日常开发体验会很差

## 参考资料

| 文件 | 内容 | 何时读 |
|------|------|--------|
| `references/skill-types.md` | 9 类 Skill 分类体系 + 典型示例 | 决定要做什么类型的 skill 时 |
| `references/distribution.md` | 分发、市场管理、组合、度量 | 准备分享 skill 给团队时 |
