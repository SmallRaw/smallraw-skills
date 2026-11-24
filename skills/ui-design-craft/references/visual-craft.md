# 视觉与几何工艺参考（31 项）

覆盖 Spacing（6）、Typography（9）、Color（5）、Shape（6）、Depth（5）。每项列出 **AI 常见误区 → 工艺修复**、可执行实现要点及易混淆词辨析。数值为示意基线，实施时优先匹配项目既有 Design Tokens。

---

## 一、间距（Spacing · 6）

### 1. Padding（内边距）
- **症状**：看着挤（cramped）
- **Before → After**：文字贴边（`padding: 6px`）→ 容器边缘留足呼吸空间（如 `padding: 20px`），**同时保持内部元素间距不变**。
- **易混淆**：`Gap` 是兄弟项之间距离，不是内容到容器边缘；`Line Height` 是同段行距。

### 2. Gap（条目间距）
- **症状**：看着挤（cramped）
- **Before → After**：标签/列表项挤成一团（`gap: 0`）→ 横向与纵向统一清楚分开（如 `gap: 12px`），不破坏容器原有 `padding`。
- **易混淆**：`Padding` 管内容到边缘；`Proximity` 通过**不等距**表达分组，而 `Gap` 是同组内的均匀间距。

### 3. Line Height（行高）
- **症状**：看着挤（cramped）
- **Before → After**：长段文字密得串行（`line-height: 1.15`）→ 正文放宽到 `1.6–1.7` 提升可读性，大标题仍保持紧凑（如 `1.15–1.2`）。
- **易混淆**：`Gap` 分开独立元素；`Line Height` 只管同一段落内的行间垂直距离。

### 4. Proximity（亲密性）
- **症状**：看着挤、没重点（cramped / no-hierarchy）
- **Before → After**：处处等距（全部 `12px`，表单标签夹在上下两个框中间）→ 组内紧贴、组间拉开（如标签到自身输入框 `6px`，字段组之间 `18px`）。
- **易混淆**：`Gap` 是单一均距；`Whitespace` 是区块级留白，用于制造焦点。

### 5. Whitespace（留白）
- **症状**：看着挤、没重点（cramped / no-hierarchy）
- **Before → After**：元素全部顶在上方紧凑堆砌（`4px` 均距）→ 在不增删元素的前提下建立区块呼吸节奏（如导航→标题 `24px`，标题→副标题 `8px`，副标题→主按钮 `12px+`）。
- **易混淆**：`Padding` 限于单个容器内；`Proximity` 负责成组，`Whitespace` 负责给核心信息腾出视觉焦点。

### 6. Divider vs. Space（分割线与留白）
- **症状**：发飘发脏、没重点（muddy / no-hierarchy）
- **Before → After**：每一行下面都画一条线 → 同组内优先用留白分开，只在跨大组边界处留一条 `0.5px` 低对比细线。
- **易混淆**：`Hairline Border` 勾勒容器外轮廓；`Divider` 分隔容器内部内容。

---

## 二、排版（Typography · 9）

### 7. Hierarchy（视觉层级）
- **症状**：没重点（no-hierarchy）
- **Before → After**：所有文字同字号全黑（全 `13px`）→ 用字号、字重、颜色拉开三层阅读顺序（如核心数字 `28px 600`、标签 `12px` 中灰、更新时间 `11px` 浅灰；注意正文/可读信息不牺牲可读性）。
- **易混淆**：`Font Weight` 是层级的手段之一；`Muted Text` 负责让最低层级退后。

### 8. Font Weight（字重）
- **症状**：没重点、看着挤（no-hierarchy / cramped）
- **Before → After**：紧列表里靠放大字号强调（`17px · 400`）→ 保持紧凑字号，改用加粗建立重点（`13px · 600`），层次更稳且不占版面。
- **易混淆**：`Tracking` 改字距不改笔画粗细；`Hierarchy` 是整体阅读顺序。

### 9. Tracking（字距）
- **症状**：发飘发脏（muddy）
- **Before → After**：大标题与小号全大写都留默认 `letter-spacing: 0` → 大标题微收（如 `-0.03em` 到 `-0.045em`）显得紧致，小号全大写标签放宽（如 `+0.08em` 到 `+0.12em`），正文维持默认 `0`。
- **易混淆**：`Line Height` 调垂直行距，`Tracking` 调水平字距。

### 10. Tabular Numbers（等宽数字）
- **症状**：发飘发脏（muddy）
- **Before → After**：比例数字导致金额列小数点错位、实时数字跳动晃眼 → 给价格、表格数字、统计指标和计时器统一加 `font-variant-numeric: tabular-nums`。
- **易混淆**：`Tracking` 影响所有字符间距，`tabular-nums` 仅统一数字槽宽。

### 11. Text Balance（标题平衡断行）
- **症状**：发飘发脏（muddy）
- **Before → After**：默认换行让短标题最后一行只剩一个孤字 → 给短标题加 `text-wrap: balance`，让各行长度接近。
- **易混淆**：`Line Clamp` 会在超过 N 行时裁掉内容；`Text Balance` 只优化断行位置不删字。

### 12. Line Clamp（多行截断）
- **症状**：看着挤、发飘发脏（cramped / muddy）
- **Before → After**：同排卡片简介长短不一导致底边参差不齐 → 用 `line-clamp: 2`（`-webkit-line-clamp`）统一截断并显示省略号，保证网格底边齐平。
- **易混淆**：`Middle Truncation` 用于保留单行文件名/ID 末尾；`Line Clamp` 用于限制多行段落行数。

### 13. Baseline Alignment（基线对齐）
- **症状**：发飘发脏、没重点（muddy / no-hierarchy）
- **Before → After**：`$29 / month`、`128 ms` 用 `align-items: center` 垂直居中，小单位悬浮在半空 → 改为 `align-items: baseline`，让大小字号稳稳落在同一条文字基线上。
- **易混淆**：`Optical Alignment` 校正不对称图形位置；`Baseline Alignment` 对齐混排文字基线。

### 14. Shortcut Hint（快捷键徽标）
- **症状**：没重点、发飘发脏（no-hierarchy / muddy）
- **Before → After**：快捷键用括号混写在菜单文案后（`Search (⌘K)`）参差难扫读 → 拆出并右对齐到行末，做成带极细描边的等宽小键帽（`⌘ K`）。
- **易混淆**：`Command Palette` 是全局命令搜索浮层；`Shortcut Hint` 是菜单内提示直达按键的微样式。

### 15. Middle Truncation（中间截断）
- **症状**：看着挤、没重点（cramped / no-hierarchy）
- **Before → After**：长文件名或 ID 用末尾省略，把扩展名和版本号砍没了（`design-system-tokens-v2…`）→ 改为中间省略（`design-sy…light.css`），同时保留开头与区分后缀。
- **实现提示**：可将字符串拆为前半段（`overflow: hidden; text-overflow: ellipsis`）+ 固定不收缩的末尾段（`flex-shrink: 0`）。
- **易混淆**：`Line Clamp` 用于多行段落；`Middle Truncation` 用于单行高识别度标识符。

---

## 三、颜色（Color · 5）

### 16. Accent（强调色）
- **症状**：没重点、发飘发脏（no-hierarchy / muddy）
- **Before → After**：筛选、排序、导出、发布 4 个按钮都在抢颜色 → 次要按钮退回中性白底细描边，强调色只留给唯一的主操作。
- **易混淆**：`Semantic Color` 传达状态含义；`Contrast` 保障可读性；`Accent` 决定第一眼落点。

### 17. Contrast（对比度）
- **症状**：发飘发脏（muddy）
- **Before → After**：低对比灰字发虚（如 `1.7:1`）→ 拉开文本与背景对比度（如白底上标题 `#171717` 约 `18:1`，次要元信息 `#737373` 约 `4.7:1`，守住 WCAG `4.5:1` 常规文本底线）。
- **易混淆**：`Muted Text` 是有克制地降低强调，但仍必须通过 `Contrast` 底线。

### 18. Muted Text（弱化文字）
- **症状**：没重点、发飘发脏（no-hierarchy / muddy）
- **Before → After**：正文、作者、时间全部纯黑（`#171717`）争抢注意力 → 分出灰阶（如正文 `#171717`、作者/操作 `#737373`、辅助元信息退后），让主内容先跳出来。
- **注意**：最弱一层如果是需要阅读的信息，仍需检查实际对比度，不盲目用过浅颜色。

### 19. Semantic Color（语义色）
- **症状**：没重点（no-hierarchy）
- **Before → After**：成功/警告/错误状态全用灰色掩盖风险 → 仅在状态位使用约定语义色（绿=成功、琥珀黄=警告、红=错误），其余结构保持中性。
- **易混淆**：不要拿语义红/绿当装饰色，也不要和 `Accent` 混用职责。

### 20. Tint & Shade（同色明暗阶）
- **症状**：发飘发脏、没重点（muddy / no-hierarchy）
- **Before → After**：状态标签、Banner、选中态直接铺高饱和纯色块，刺眼吵闹 → 改用同一色相的浅色底（tint）+ 极细同色描边 + 深色字（shade），清爽且高对比可读。
- **易混淆**：`Semantic Color` 决定选哪个色相，`Tint & Shade` 决定这组色相如何柔和落到背景与文字上。

---

## 四、形状（Shape · 6）

### 21. Border Radius（圆角）
- **症状**：发飘发脏（muddy）
- **Before → After**：`24px` 大圆角配全胶囊输入框/按钮显得圆鼓鼓且松散 → 收敛成克制统一的小体系（如卡片 `12px`、输入框与按钮 `8px`），整体更利落。
- **易混淆**：`Border Radius` 设定单个形状的圆度；`Concentric Radius` 规定嵌套两者的圆角数学关系。

### 22. Concentric Radius（同心圆角）
- **症状**：发飘发脏（muddy）
- **Before → After**：外卡片和内嵌图片/子盒都设 `20px`，导致四角缝隙比直边宽一截 → `内圆角 = 外圆角 - 内边距`（如 `20 - 10 = 10px`），让转角与直边缝隙一致。
- **易混淆**：如果内边距大于等于外圆角，内层可取极小圆角或直角，避免负值。

### 23. Nested Cards（卡片套娃）
- **症状**：发飘发脏、看着挤（muddy / cramped）
- **Before → After**：三层卡片层层嵌套，每层都带边框、阴影和额外 padding 浪费空间 → 压平成单层卡片，内部信息靠留白和至多一条 `0.5px` 细线分组。
- **易混淆**：需要区分真正独立的表面或交互边界时才保留容器，不要机械套壳。

### 24. Hairline Border（极细描边）
- **症状**：发飘发脏（muddy）
- **Before → After**：厚重实体灰边（`1.5px solid #a3a3a3`）显得生硬沉重 → 换成低对比极细描边（如 `0.5px` 或 `1px` 配合 `rgb(0 0 0 / 8%–10%)`；高分屏/深色模式按对应透明度适配），不额外堆重阴影。
- **易混淆**：`Layered Shadow` 用于抬起浮层，`Hairline Border` 用于利落勾勒平面边缘。

### 25. Optical Alignment（视觉对齐）
- **症状**：发飘发脏（muddy）
- **Before → After**：圆形播放按钮里的三角形按 bounding box 几何居中，但肉眼看偏左 → 按视觉重心向右微移（如 `2–3px`）。含图标的按钮同理，图标侧 padding 可略收紧以平衡视觉边距。
- **易混淆**：`Concentric Radius` 校圆角，`Baseline Alignment` 校文字基线，`Optical Alignment` 校不对称图形重心。

### 26. Avatar Stack（叠加头像组）
- **症状**：看着挤、常见组件（cramped / hard-to-name）
- **Before → After**：多名协作者头像 `8px` 平铺撑爆行宽 → 改为负间距叠加（如 `-8px`），每颗外圈加 `2px` 与背景同色的切割环防粘连，超出人数用 `+3` 胶囊收口。
- **易混淆**：正常兄弟元素用正 `Gap`；`Avatar Stack` 是刻意用负重叠 + 切割环换空间。

---

## 五、层次（Depth · 5）

### 27. Layered Shadow（多层阴影）
- **症状**：发飘发脏（muddy）
- **Before → After**：单层厚黑阴影（`0 16px 32px rgb(0 0 0 / 24%)`）像脏印子 → 拆成 3–4 层极淡递增扩散投影（如 `1 / 3 / 6 / 12px`，约 `4%–6%` 透明度）再叠 `1px` 极淡描边环，通透自然。
- **易混淆**：`Hairline Border` 管平贴边界，`Layered Shadow` 管抬升高度，`Scrim` 管压暗整页。

### 28. Scrim（遮罩层）
- **症状**：发飘发脏、没重点（muddy / no-hierarchy）
- **Before → After**：弹窗直接盖在明亮列表上，背景文字持续干扰视线 → 背后垫一层半透明深色遮罩（如 `rgb(0 0 0 / 26%)`），压暗背景锁定前景焦点。
- **易混淆**：`Modal vs. Drawer` 决定交互形式；`Scrim` 是弹窗背后的视觉聚焦层。

### 29. Edge Fade（边缘渐隐）
- **症状**：看着挤、发飘发脏（cramped / muddy）
- **Before → After**：横向可滚动标签栏右侧硬裁切，文字被腰斩且看不出还能滚 → 给滚动容器边缘加 `mask-image` 渐变渐隐（如右侧 `48–56px`），柔化截断并暗示可滑动。
- **实现提示**：滚到末尾时可淡出遮罩，避免遮挡最后一个真实可点项。
- **易混淆**：`Line Clamp` 用省略号截断固定文本；`Edge Fade` 柔化可滚动溢出边界。

### 30. Sticky Header（吸顶层级）
- **症状**：发飘发脏、常见组件（muddy / hard-to-name）
- **Before → After**：列表滚动时顶栏滚丢，或吸顶却透明/无边界导致下方文字穿帮 → 用 `position: sticky` + 不透明（或模糊）背景，在内容滚到下方后浮出 `0.5px` 底边线与轻柔向下投影压住滚动行。
- **易混淆**：不要在未滚动的静止态就堆重阴影；分隔线/投影在滚动触发时最有层次感。

### 31. Floating Bar（悬浮操作栏）
- **症状**：看着挤、常见组件（cramped / hard-to-name）
- **Before → After**：多选条目时把批量操作按钮硬塞进顶部工具栏，既挤爆顶栏又离选中的行太远 → 选中后在底部浮起一层高对比悬浮胶囊（显示计数 + 批量操作 + 取消），就近处理且不扰动页面布局。
- **易混淆**：`Sticky Header` 常驻顶部承载导航/表头；`Floating Bar` 仅在多选上下文按需浮起。
