# 动效与交互组件语义参考（23 项）

覆盖 Motion（8）与 Layout & UI（15）。重点纠偏 AI 常写的生硬动画与容易用反的交互控件。所有动效实现均应尊重 `prefers-reduced-motion: reduce`。

---

## 一、动效（Motion · 8）

### 1. Easing（缓动曲线）
- **症状**：动效生硬（stiff）
- **Before → After**：面板/浮层用 `linear` 匀速像机器人 → 进场改用快起步、慢收尾的 `ease-out`（如 `cubic-bezier(0.32, 0.72, 0, 1)`，时长约 `200–260ms`），落位自然干脆。
- **易混淆**：`Spring` 用物理参数模拟弹性；`Easing` 是固定时间曲线。

### 2. Directional Motion（方向过渡）
- **症状**：动效生硬（stiff）
- **Before → After**：进子页与返回都原地淡入淡出，丢失空间层级感 → 沿导航轴移动：进子页从右滑入（父页可微左退），返回向右滑出，一眼明白前进与后退。
- **易混淆**：`Shared Element` 聚焦单个物体跨页变形；`Directional Motion` 表达整页层级前进/返回。

### 3. Spring（弹簧动效）
- **症状**：动效生硬（stiff）
- **Before → After**：分段滑块、抽屉回弹用死板曲线毫无生命力 → 改用物理弹簧（示意参数：`stiffness: 400, damping: 30`），带极轻微落点势能但不过度弹跳。
- **易混淆**：高频微交互用高阻尼克制回弹，避免晃个不停拖慢操作。

### 4. Stagger（错峰出场）
- **症状**：动效生硬（stiff）
- **Before → After**：整个列表所有行 `0ms` 同时闪现显得生硬 → 给首屏条目叠短错峰延迟（如每行 `40–50ms`，即 `0 / 50 / 100ms`），但务必给总延迟封顶（避免长列表等半天）。
- **易混淆**：`Easing / Spring` 管单项怎么动，`Stagger` 管多项何时依次起步。

### 5. Press State（按压反馈）
- **症状**：动效生硬（stiff）
- **Before → After**：点按钮在鼠标按下瞬间毫无视觉变化 → 按下时即时响应（如 `scale(0.97)`，`100–120ms ease-out`），松手顺滑弹回，让界面有实体手感。
- **易混淆**：释放可以接弹簧，但**按下去的那一下必须即时**，不能有延迟。

### 6. Shared Element（共享元素过渡）
- **症状**：动效生硬（stiff）
- **Before → After**：点开缩略图直接 `0ms` 硬切到详情页，视线断开 → 让同一张图连续放大变形为详情视图（如 `400–520ms ease-out` 或 View Transitions API），维持视觉追踪。
- **易混淆**：`Origin-Aware Motion` 是新浮层从触发角展开；`Shared Element` 是既有物体本身跨视图变形。

### 7. Origin-Aware Motion（原点缩放）
- **症状**：动效生硬（stiff）
- **Before → After**：下拉菜单/浮层从 `transform-origin: center` 凭空弹出，与触发按钮割裂 → 把 `transform-origin` 设在触发按钮对应角落（如 `top right`），配合 `scale(0.92 → 1)` 与淡入顺势展开。
- **易混淆**：`Directional Motion` 沿页面导航轴移动；`Origin-Aware Motion` 把浮层锚定在点击源头。

### 8. Hover Reveal（悬停显现）
- **症状**：看着挤、动效生硬（cramped / stiff）
- **Before → After**：列表每一行常驻复制/编辑/删除图标，满屏重复视觉噪音 → 默认隐藏行操作（可显示时间戳等静默信息），仅在悬停或键盘聚焦当前行（`:hover` / `:focus-within`）时平滑浮现操作按钮。
- **无障碍注意**：触屏无 hover，需保留点击展开或常驻轻量入口，不要让功能不可达。
- **易混淆**：`Progressive Disclosure` 把低频设置折到点击入口后；`Hover Reveal` 在指针/焦点到达行时浮现高频行工具。

---

## 二、布局与通用组件（Layout & UI · 15）

### 9. Button Hierarchy（按钮主次）
- **症状**：没重点（no-hierarchy）
- **Before → After**：同一区域并排两个同等重量的实心大按钮 → 一个区域只保留 **1 个**实心主按钮，次要动作退成描边按钮或纯文字链接。
- **易混淆**：`Accent` 通常落在主按钮上；`Segmented Control` 是平级视图切换，不是主次按钮。

### 10. Touch Target（点击热区）
- **症状**：看着挤、常见组件（cramped / hard-to-name）
- **Before → After**：图标只有 `15–20px`，外框按钮也只有 `20×20px`，极易点空或误触 → 图标外观保持纤细，但可点热区扩大到至少 `40×40px`（移动端优先遵循 `44×44px`）。
- **易混淆**：`Padding` 是容器呼吸感，`Gap` 是项间距，`Touch Target` 保障小控件的可点面积。

### 11. Empty State（空状态）
- **症状**：常见组件（hard-to-name）
- **Before → After**：光秃秃一行“暂无数据”让人不知道能干嘛 → 补齐三件套：轻量图标 + 一句话说明这里装什么 + 一个明确引导下一步的主动作（如“新建收藏夹”）。
- **易混淆**：`Skeleton` 表示正在加载；`Empty State` 表示加载完确实没有数据；`Suggested Prompts` 是 AI 聊天的空状态。

### 12. Inline Validation（即时校验）
- **症状**：常见组件（hard-to-name）
- **Before → After**：只在表单顶部堆一条报错汇总，用户得回头找哪个框错 → 校验确定出错时，把报错信息直接放在对应输入框正下方，并给该输入框语义红描边。
- **易混淆**：避免用户刚打第一个字就刺眼报错，通常在失焦或提交后即时反馈，修改正确后立刻清除。

### 13. Skeleton（骨架屏）
- **症状**：常见组件（hard-to-name）
- **Before → After**：空白卡片正中放一个孤零零的转圈 Spinner，加载完页面剧烈跳动 → 按最终真实布局画灰色占位（头像圆、标题条、两行正文），加载完成原位平滑替换。
- **易混淆**：`Streaming Text` 是真实内容逐字到达；`Skeleton` 是内容到达前先稳住形状。

### 14. Popover vs. Tooltip（浮层与提示）
- **症状**：常见组件（hard-to-name）
- **Before → After**：把可点击的链接、复制按钮塞进鼠标移开就消失的 Tooltip → **Tooltip 只放一句纯文字说明**；凡是包含可点、可选、可复制控件的内容一律放进点击展开、常驻的 **Popover**。
- **易混淆**：需要占更大空间或阻断页面时才升级成 `Drawer` 或 `Modal`。

### 15. Modal vs. Drawer（弹窗与抽屉）
- **症状**：常见组件（hard-to-name）
- **Before → After**：点开列表项详情直接弹居中 Modal 遮死整张列表 → 查看/编辑单条详情改用侧边滑出的 **Drawer**，让底层列表依然可见可对照；**Modal** 只留给必须中断流程的高权重确认或独立聚焦任务。
- **易混淆**：`Scrim` 用于配合 Modal 压暗背景；`Shared Element` 也可在保留位置感的前提下打开详情。

### 16. Tabs vs. Segmented（标签页与分段器）
- **症状**：常见组件、没重点（hard-to-name / no-hierarchy）
- **Before → After**：页面切换和 `7D / 30D / 90D` 筛选都画成两排一样的下划线 Tab，像两层重复导航 → **Tabs** 负责切换不同页面/频道；**Segmented Control** 负责切换同一份数据的视图或区间，就近放在数据旁。
- **易混淆**：两者都是单选切换，区别在作用范围（页面层级 vs 同数据视图）。

### 17. Switch vs. Checkbox（开关与复选框）
- **症状**：常见组件（hard-to-name）
- **Before → After**：用复选框做“立即生效的自动保存”，或用开关做“点提交才算数的同意条款” → **Switch = 拨动立刻生效**；**Checkbox = 勾选后等待提交/保存按钮才生效**（或用于多选条目）。
- **易混淆**：永远按“是否即时生效”来选，而不是按外观好看与否。

### 18. Command Palette（命令面板）
- **症状**：常见组件（hard-to-name）
- **Before → After**：常用动作埋在 `File ▸ Export ▸ As PDF` 多层菜单里翻半天 → 提供 `⌘K`（Windows `Ctrl+K`）全局可搜命令面板，打几个字按回车直达动作，并展示对应 `Shortcut Hint`。
- **易混淆**：`Combobox` 只过滤某一个字段的选项；`Slash Command` 在编辑器光标处触发；`Command Palette` 面向全局应用动作。

### 19. Bento Grid（便当盒布局）
- **症状**：没重点、常见组件（no-hierarchy / hard-to-name）
- **Before → After**：4 个同等大小的仪表盘方格看不出谁最重要 → 按重要性分配格子跨度（如核心收入占大主格，团队/在线率/结算占侧边小格），用面积直接建立层级。
- **易混淆**：保持便当格内部扁平，不要在格子里再做 `Nested Cards`。

### 20. Progressive Disclosure（渐进式披露）
- **症状**：看着挤、没重点（cramped / no-hierarchy）
- **Before → After**：设置页或导出弹窗首屏铺满 5–8 个参数（含低频高级项） → 首屏只保留最核心的 2–3 项，把缩放、色彩配置、元数据等低频设置收进安静的 `Advanced options` 折叠入口。
- **易混淆**：`Thinking Disclosure` 折叠的是 AI 推理过程；`Progressive Disclosure` 折叠的是产品表单与设置中的低频控件。

### 21. Combobox（可搜下拉框）
- **症状**：常见组件、看着挤（hard-to-name / cramped）
- **Before → After**：几十个选项的普通下拉菜单只能靠滚轮肉眼翻找 → 换成顶部固定实时搜索框的 **Combobox**，输入关键词即时过滤并高亮匹配项，支持键盘上下选择。
- **易混淆**：`Command Palette` 搜全局操作，`Combobox` 搜单个表单字段的候选值。

### 22. Input Affix（输入框前后缀）
- **症状**：看着挤、常见组件（cramped / hard-to-name）
- **Before → After**：把单位或协议写在标签括号里（`价格（USD）`、`网址（含 https://）`），用户仍反复填错或重复输入 → 做成输入框内部固定的浅灰前缀/后缀槽位（`$` / `USD`、`https://`），让用户只填核心值。
- **易混淆**：`Inline Validation` 是填错后补救；`Input Affix` 是填之前锁定格式防错。

### 23. Split Button（组合按钮）
- **症状**：看着挤、没重点、常见组件（cramped / no-hierarchy / hard-to-name）
- **Before → After**：工具栏并排 5 个按钮（预览、保存草稿、发布、定时发布、导出）挤到折成两行 → 保留独立次级常用键（如 Preview / Save draft），把属于同一主动作的变体收进右侧主按钮下拉（`Publish | ▾`）。
- **易混淆**：`Button Hierarchy` 区分不同操作的权重；`Split Button` 折叠同一个主动作的多个变体。
