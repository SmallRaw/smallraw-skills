# anthropomorphic-tech-writer

把计算机原理、编程语言或框架演进、网络协议、数据库和 AI 机制写成原创的中文拟人科普故事。

它吸收「Why 先于 How、角色的处境来自技术约束、机制在失败中出现、及时揭示真实术语」这类高层方法，但不会复刻具体作者的措辞、人物或情节。

## 适合的请求

```text
用第一人称故事讲清楚数据库索引为什么能减少扫描。
```

```text
把这份关于缓存击穿的说明改成小白能读完的技术寓言。
```

```text
写一篇编程语言成长史，语气轻松，但所有历史事实都要能核对。
```

## 不适合的请求

- 正式 API 文档、操作手册、故障排查步骤
- 只需要定义或简短问答的任务
- 纯文学小说，不承担技术解释目标
- 要求照搬具体作者、作品、角色或段落的仿写

## 与 technical-story-explainer 的区别

`anthropomorphic-tech-writer` 是轻量直接写作 Skill，适合一篇文章从主题到成稿。`technical-story-explainer` 是更重的研究、设计、独立审稿和返工流程，适合高风险事实、复杂产品比较或需要多角色质量闸门的任务。

## 文件说明

- `SKILL.md`：入口、流程和输出约定
- `references/style-blueprint.md`：高层风格方法与原创边界
- `references/narrative-engines.md`：六种叙事引擎
- `references/fact-and-metaphor.md`：事实账本和隐喻保真
- `references/chinese-style.md`：中文叙事编辑规则
- `references/quality-gates.md`：七道终审闸门
- `evals/evals.json`：五个代表性试写任务
