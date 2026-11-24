---
name: ui-design-craft
description: 编写、审查或精细抛光 Web/App 前端 UI、组件与 AI 产品界面，或把“看着挤、没重点、发飘发脏、动效生硬、不像成品”等模糊体感转化为精确视觉与交互修复时触发。纠偏 AI 默认常犯的间距、排版、色彩、圆角、阴影、动效、控件语义与 AI 界面模式错误。需要整体产品方向、品牌性格与内容取舍时可配合 ui-design-filipiuk-style 使用；不用于纯文字写作或无界面后端任务。
---

# UI Design Craft：把“哪儿不对劲”翻译成精确工艺修复

AI 写前端界面时，往往不是大结构崩了，而是反复栽在几十个可枚举的微工艺、控件语义和 AI 交互细节上。本 skill 把常见“看着不对”的模糊体感映射到精确的设计术语与可执行改动，既用于编码前的默认纠偏，也用于审查与抛光。

> **来源与边界**：本 skill 的 65 项工艺词汇与对比模式提炼自 `topinspo.design/vocabulary`，并针对 AI 编码常见失误做了工程化重组。文中的 `px`、`ms`、色值均为**示意基线**，实施时优先继承项目既有的 Design Tokens、组件库与平台规范。产品方向、品牌性格与整体取舍交由 `ui-design-filipiuk-style`（若已安装）负责；本 skill 聚焦像素级工艺、控件选型与交互完成度。

## 工作方式

1. **先承接现有系统**：检查项目已有 tokens、组件与风格，不为了套用示意数值而破坏既有设计系统。
2. **先翻译症状，再动最准的杠杆**：把“挤 / 没重点 / 发脏 / 生硬”定位到具体术语，只改直接相关的属性（例如调容器 `padding` 时不误伤子项 `gap`；空间紧时优先加 `font-weight` 而不是盲目放大字号）。
3. **按需读参考表**：不要一次全读 `references/`，只按当前页面涉及的领域加载对应文件。
4. **交付前做一次“AI 味”扫描**：对照下方 6 条纠偏规则与 Gotchas 快速复查实现代码或渲染结果。

## 症状 → 精确诊断路由

收到模糊反馈或自查觉得“不像成品”时，先按体感定位候选术语，再查阅对应参考表：

| 体感症状 | 优先排查的工艺术语 | 对应参考表 |
|---|---|---|
| **看着挤（Cramped）** | Padding、Gap、Line Height、Proximity、Whitespace、Font Weight、Line Clamp、Middle Truncation、Nested Cards、Avatar Stack、Edge Fade、Floating Bar、Hover Reveal、Touch Target、Progressive Disclosure、Combobox、Input Affix、Split Button、Thinking Disclosure、Context Chips | `visual-craft.md` / `interaction-and-patterns.md` / `ai-ui-patterns.md` |
| **没重点（No focus）** | Hierarchy、Proximity、Whitespace、Divider vs. Space、Font Weight、Baseline Alignment、Shortcut Hint、Accent、Muted Text、Semantic Color、Tint & Shade、Scrim、Button Hierarchy、Tabs vs. Segmented、Bento Grid、Progressive Disclosure、Split Button、Diff View、Approval Gate | `visual-craft.md` / `interaction-and-patterns.md` / `ai-ui-patterns.md` |
| **发飘发脏（Muddy）** | Concentric Radius、Border Radius、Nested Cards、Hairline Border、Layered Shadow、Optical Alignment、Baseline Alignment、Tracking、Tabular Numbers、Text Balance、Contrast、Tint & Shade、Scrim、Edge Fade、Sticky Header、Citation Pill | `visual-craft.md` |
| **动效生硬（Stiff）** | Easing、Origin-Aware Motion、Directional Motion、Spring、Stagger、Press State、Shared Element、Hover Reveal、Streaming Text、Undo Toast | `interaction-and-patterns.md` |
| **控件选错 / 难命名** | Switch vs. Checkbox、Tabs vs. Segmented、Popover vs. Tooltip、Modal vs. Drawer、Touch Target、Empty State、Inline Validation、Skeleton、Command Palette、Bento Grid、Combobox、Input Affix、Split Button、Avatar Stack、Sticky Header、Floating Bar | `interaction-and-patterns.md` |
| **AI 界面粗糙（AI UI）** | Prompt Composer、Context Chips、Slash Command、Suggested Prompts、Streaming Text、Thinking Disclosure、Tool Call Steps、Citation Pill、Diff View、Undo Toast、Approval Gate | `ai-ui-patterns.md` |

## 纠偏 AI 默认坏习惯的 6 条核心规则

### 1. 几何与表面：拒绝卡片套娃、内外同圆角与糊成一团的边影
- **同心圆角（Concentric Radius）**：嵌套元素的圆角遵循 `内圆角 = 外圆角 - 间距`（如外 `20px`、内边距 `10px` → 内 `10px`），不要内外都写死同一个圆角。
- **压平卡片套娃（Nested Cards）**：避免卡片里再套带边框和阴影的卡片；压平成单层容器，内部优先用留白分组，必要时只留一条 `0.5px` 低对比 **极细描边（Hairline Border）**。
- **克制圆角与多层投影**：收拢圆角体系（容器略大、控件略小，避免全屏 `24px` + 胶囊）；浮起表面用 **多层极淡阴影（Layered Shadow）** 叠加细描边，不用单层高不透明度大黑影。
- **边界与遮罩**：弹窗必须配半透明 **遮罩层（Scrim）**；吸顶栏在内容滚到下方时浮现底边线与轻阴影（**Sticky Header**）；横向滚动容器边缘用 `mask-image` 做 **边缘渐隐（Edge Fade）**，不要生硬把字砍成一半。
- **视觉校准优先于数学居中**：播放三角等不对称图形做 **视觉对齐（Optical Alignment）** 微调；大数字配小单位（如 `$29 / month`、`128 ms`）用 `align-items: baseline` 做 **基线对齐（Baseline Alignment）**，不要垂直居中让单位悬空。

### 2. 间距与排版：用间距差分组，用字重与排版特性提精度
- **亲密性（Proximity）高于均匀间距**：同一组内（如表单标签与输入框）要紧贴，不同组之间要明显拉开；不要用同一个 `gap` 铺满整个表单或列表。
- **留白优先于分割线（Divider vs. Space）**：同类行靠留白分开，只在跨分组处保留极淡细线，不要每行下面画横线。
- **紧空间加字重不放大字号**：列表或高密面板中优先用 `font-weight`（如 600）建立层级，而不是把字号撑大挤坏行高。
- **四个必检排版细节**：数字列/金额/实时指标必开 `font-variant-numeric: tabular-nums`（**Tabular Numbers**）；短标题加 `text-wrap: balance` 防末行孤字（**Text Balance**）；大标题微收负字距、小号全大写放宽正字距（**Tracking**）；长文件名/ID 用 **中间截断（Middle Truncation）** 保留后缀与版本号，多行摘要用 **Line Clamp** 齐平底边。
- **快捷键独立右对齐**：菜单里的快捷键拆成右侧等宽小键帽（**Shortcut Hint**），不要混在括号文案里。

### 3. 色彩分工：收紧强调色，用同色明暗阶替代刺眼色块
- **唯一强调色（Accent）与按钮主次（Button Hierarchy）**：同一区域只留一个实心主按钮承接强调色，筛选/次级动作退成中性描边或文字链接。
- **同色明暗阶（Tint & Shade）**：状态标签、提示条、选中态优先采用“同色相浅底 + 极细同色边 + 深色文字”，替代高饱和纯色实心块。
- **语义色与对比度底线**：**语义色（Semantic Color）** 只用于状态（成功/警告/错误）；**弱化文字（Muted Text）** 用阶梯灰度退后，但常规可读文字仍须守住对比度底线（≥ 4.5:1）。

### 4. 控件语义与密度：按生效时机选控件，把低频动作收起来
- **四组极易用反的控件语义**：
  - **Switch vs. Checkbox**：立刻生效用开关，点提交/保存才生效用复选框。
  - **Tabs vs. Segmented**：切换页面/频道用标签页，切换同一份数据的视图或时间范围用分段器。
  - **Popover vs. Tooltip**：纯文字短说明用 Tooltip，任何包含可点控件的内容放进 Popover。
  - **Modal vs. Drawer**：阻断式确认用 Modal，查看/编辑详情且需保留列表上下文用侧边 Drawer。
- **控制视觉噪音与误触**：小图标保持纤细外观但 **点击热区（Touch Target）** ≥ `40×40px`；行级次要动作做 **悬停显现（Hover Reveal）**；多选批处理用底部 **悬浮操作栏（Floating Bar）**；同组主动作变体收进 **组合按钮（Split Button）**；低频配置用 **渐进式披露（Progressive Disclosure）**；多人头像用带白边切割的 **叠加头像组（Avatar Stack）**。
- **表单与加载闭环**：固定单位/协议做成 **输入框前后缀（Input Affix）**；长选项下拉换 **可搜下拉框（Combobox）**；错误紧贴字段下方 **即时校验（Inline Validation）**；加载态用匹配最终结构的 **骨架屏（Skeleton）**，零数据用带引导动作的 **空状态（Empty State）**。

### 5. 微动效：快起步慢收尾、从触发点长出来、响应手感即时
- **曲线与物理感**：进场改用 `ease-out`（如 `cubic-bezier(0.32, 0.72, 0, 1)`）取代 `linear`；滑块落位与切换可用克制的 **Spring**；点击按下瞬间给 `scale(0.97)` 级 **按压反馈（Press State）**。
- **空间连贯性**：浮层/菜单把 `transform-origin` 锚在触发按钮角落展开（**Origin-Aware Motion**）；进子页/返回用左右 **方向过渡（Directional Motion）**，详情展开可用 **共享元素过渡（Shared Element）**；列表入场适度 **错峰（Stagger）**。
- **必守偏好**：所有非必要位移动效遵循 `prefers-reduced-motion: reduce`。

### 6. AI 产品界面：把过程结构化，按风险分级确认
- **输入体验**：用多行 **Prompt Composer** 收纳附件/模型/发送键，引用文件收成上方可删 **Context Chips**，编辑器内提供光标处 **Slash Command**，空对话给 2–3 个 **Suggested Prompts**。
- **输出与透明度**：首字快速 **Streaming Text**；推理过程收成可展开的一行 **Thinking Disclosure** 让答案先可见；Agent 动作展示为带状态的 **Tool Call Steps** 而非转圈+原始日志；来源做成编号 **Citation Pill** + 底部卡片；改写建议用单行 **Diff View**（红删绿增 + Accept/Reject）。
- **执行风险分级**：可逆动作直接执行并给 5 秒 **Undo Toast**（别先弹“确定吗”）；外发、删改等不可逆或外部生效动作必须停在结构化 **Approval Gate** 卡片，写明影响范围并等待人工确认。

## Gotchas

1. **把示意数值当成硬规则覆盖项目系统** — 参考表里的 `20px`、`12px`、`240ms`、`#171717` 是解释原理的示意值；项目已有 spacing/radius/color tokens 时，必须先对齐项目系统再微调。
2. **Hover Reveal 导致键盘与触屏不可达** — 隐藏行内按钮时，必须同时在 `:focus-within` 显示，并在触屏/窄屏提供可见入口（如 `⋯` 菜单），不能只靠 `:hover`。
3. **Weakened ≠ 看不清** — 做 Muted Text 时一味调浅颜色或叠 `opacity`，容易跌破 4.5:1 可读对比度；用明确的中性灰阶并核对背景对比度。
4. **给所有数字忘开 `tabular-nums`** — 表格金额、倒计时、配额进度和实时计数器没开 `tabular-nums` 时，视觉立刻显“抖”和“廉价”；应默认加在所有数值类样式上。
5. **给高频列表加过长 Stagger** — 50ms × 20 行会拖出 1 秒卡顿感；错峰只用于首屏少量条目，并限制总延迟上限（通常 ≤ 250–300ms）。
6. **在可逆操作上滥用 Modal，却把高危 Agent 动作藏在纯文本里** — 归档/删除草稿优先用 **Undo Toast** 保持流畅；发邮件、写生产库、删不可恢复资源才必须用 **Approval Gate**。
7. **把长文件名用 `text-overflow: ellipsis` 末尾截断** — 末尾截断会砍掉 `.css`、`_v2`、环境后缀等最关键的区分信息；文件名/路径/ID 应使用 **Middle Truncation**。
8. **动一个参数顺手改坏别的参数** — 用户说“卡片太挤”往往缺的是 `padding` 或 `proximity` 分组差，不要顺手把圆角、阴影、配色全重写一遍。

## 参考资料索引

按当前任务涉及的问题按需读取，无需全量加载：

| 文件 | 覆盖范围 | 何时读 |
|---|---|---|
| `references/visual-craft.md` | 间距(6)、排版(9)、颜色(5)、形状(6)、层次(5) — 共 31 项视觉与几何工艺词条 | 解决看着挤、没重点、发飘发脏、圆角/阴影/排版/色彩精度问题时 |
| `references/interaction-and-patterns.md` | 动效(8)、布局与通用组件(15) — 共 23 项动效与控件语义词条 | 调整动效曲线/原点/手感，或选型 Switch/Tabs/Popover/Drawer/Combobox/Split Button 等控件时 |
| `references/ai-ui-patterns.md` | AI 界面专属模式(11) — 输入、流式、思考折叠、工具步骤、引用、Diff、撤销与审批门禁 | 设计或优化 Chat、Copilot、Agent、AI 编辑器界面时 |
