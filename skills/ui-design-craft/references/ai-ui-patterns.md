# AI 产品界面模式参考（11 项）

覆盖 Chat、Copilot、AI 编辑器与 Agent 产品中最常被 AI 自己写粗糙的 11 个交互模式。核心原则：**让输入结构化、让生成过程透明但不抢答案、让执行按可逆性分级确认**。

---

## 一、输入与启动（Input & Onboarding · 4）

### 1. Prompt Composer（AI 输入框）
- **症状**：AI 界面、常见组件（ai-ui / hard-to-name）
- **Before → After**：单行 `<input>` 配右侧孤零零的 `Submit` 按钮 → 升级为多行自适应输入容器，左下角集成附件、模型/模式切换等轻量工具槽，右下角放明确的圆形发送/停止按钮。
- **易混淆**：`Context Chips` 住在 Composer 上方承载引用；`Slash Command` 在 Composer 或编辑器内输入触发。

### 2. Context Chips（上下文标签）
- **症状**：AI 界面、看着挤（ai-ui / cramped）
- **Before → After**：把引用的文件路径或代码片段直接粘贴成一大坨纯文本挤爆输入框 → 收拢成输入框上方紧凑、可一键删除的胶囊标签（如 `header.tsx ×`），让下方核心指令保持干净可读。
- **易混淆**：`Citation Pill` 标注 AI 回答的来源；`Context Chips` 标注用户附加给 AI 的上下文输入。

### 3. Slash Command（斜杠指令）
- **症状**：AI 界面、常见组件（ai-ui / hard-to-name）
- **Before → After**：调用 AI 总结/翻译/改写要去顶部菜单 `Insert ▸ AI ▸ Summarize` 层层翻找 → 在编辑器或输入框光标处键入 `/` 即时弹出就地动作菜单，方向键+回车执行。
- **易混淆**：`Command Palette`（`⌘K`）面向全局应用操作；`Slash Command` 面向当前光标位置的内容操作。

### 4. Suggested Prompts（推荐提问）
- **症状**：AI 界面、常见组件（ai-ui / hard-to-name）
- **Before → After**：空白对话只有一句冷冰冰的问候语，用户对着输入框发呆 → 在问候语下方放 2–4 个具体、贴近产品能力的推荐提问标签（点击直接填入或发送），降低冷启动阻力。
- **易混淆**：本质上是 AI 对话场景专属的 `Empty State`。

---

## 二、流式生成与过程透明（Streaming & Observability · 4）

### 5. Streaming Text（流式输出）
- **症状**：AI 界面、动效生硬（ai-ui / stiff）
- **Before → After**：空白等待 1–2 秒以上然后整段突然砸出来 → 首批字尽快流式呈现（如 `~0.15s` 内出首字，配合轻微光标），同时避免流式排版频繁抖动跳页。
- **易混淆**：`Skeleton` 先展示形状占位；`Streaming Text` 持续展示到达的真实文字。

### 6. Thinking Disclosure（折叠思考过程）
- **症状**：AI 界面、看着挤（ai-ui / cramped）
- **Before → After**：长篇推理过程全展开，把真正有用的答案顶出首屏 → 把推理折成回答上方安静的一行（如 `Thought for 4s ▸`），默认收起（或在思考完成后自动折叠）、点击随时展开，让答案始终排在视觉最前面。
- **易混淆**：`Tool Call Steps` 展示 Agent **做了什么动作**；`Thinking Disclosure` 展示模型**怎么推理的**。

### 7. Tool Call Steps（工具调用步骤）
- **症状**：AI 界面、常见组件（ai-ui / hard-to-name）
- **Before → After**：只给一个转圈 Spinner，或者把一整屏原始 JSON/终端日志直接裸露给用户 → 整理成简短步骤列表，每次工具调用占一行，带进行中/完成/失败状态图标和一句人话摘要，原始参数折进可选项。
- **易混淆**：`Tool Call Steps` 叙述只读进度或已授权步骤；涉及高危动作需要停下来等人点头时必须用 `Approval Gate`。

### 8. Citation Pill（引用标注）
- **症状**：AI 界面、发飘发脏（ai-ui / muddy）
- **Before → After**：正文里塞满折行的长 URL，打断阅读又难核对 → 正文句末改用小编号胶囊（如 `[1]`），悬停/点击可预览，回答下方配带标题与站点名的来源卡片方便核验。
- **易混淆**：来源预览适合放进 `Popover`；`Diff View` 标的是修改变化，`Citation Pill` 标的是事实出处。

---

## 三、编辑审阅与风险控制（Review & Control · 3）

### 9. Diff View（行内对比）
- **症状**：AI 界面、没重点（ai-ui / no-hierarchy）
- **Before → After**：左右或上下两段全文并排，靠用户肉眼逐字找 AI 改了哪儿 → 合并为单行行内对比：删除词用语义红底/划线，新增词用语义绿标出，紧接清晰的 `Reject` / `Accept` 操作。
- **易混淆**：这里的红/绿是典型的 `Semantic Color`，仅用于表达增删变更，不与装饰色混用。

### 10. Undo Toast（可撤销提示）
- **症状**：AI 界面、动效生硬（ai-ui / stiff）
- **Before → After**：归档、忽略建议、应用轻量修改等可逆动作每次都先弹 `"Are you sure?"` 弹窗打断节奏 → 直接执行，并弹出停留约 `5s` 的轻提示附带 `Undo` 按钮，保持流式心流。
- **易混淆**：仅用于**可逆操作**；真正无法撤回或会对外产生副作用的动作必须交给 `Approval Gate` 或 `Modal`。

### 11. Approval Gate（人工确认节点）
- **症状**：AI 界面、没重点（ai-ui / no-hierarchy）
- **Before → After**：把“即将发邮件给 42 位客户 / 删除生产表”埋在一段普通对话文字里，极易漏看或误放行 → 在不可逆或外部生效动作执行前暂停 Agent，弹出独立结构化确认卡片，明确列出**动作、目标对象与影响范围**，并提供清晰的 `Reject` / `Approve` 按钮。
- **易混淆**：`Undo Toast` 是可逆操作的事后兜底；`Approval Gate` 是高危/外发动作的事前闸门。
