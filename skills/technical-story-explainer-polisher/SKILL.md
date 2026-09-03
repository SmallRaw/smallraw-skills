---
name: technical-story-explainer-polisher
description: 当用户已有技术科普清楚稿、故事底稿、technical-story-explainer 产物或"逻辑正确但干/不好看/说明书腔/不够沉浸"的稿子，需要润色成沉浸式中文技术故事、视频稿或长文时触发。
license: MIT
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
---

# technical-story-explainer-polisher

把"干但正确"的技术科普底稿，润色成更沉浸、更有戏、更像中文技术故事的成稿。它只负责表达、结构、人物和叙事体验；**不能新增或篡改技术事实，也不能重选戏码**——戏码原型由 explainer 在戏码地图阶段就锁定了。

最推荐的输入来自 `technical-story-explainer`：

- `01-research-and-concepts.md`（约束卡 + 戏码地图）
- `03-style-and-roles.md`
- `04-drafts.md`
- `05-final-check-and-final.md`

如果没有这些文件，也可以润色用户直接提供的稿子；但必须先标出事实缺口和戏码缺失，不能自己编补事实或重选戏码。

## 总原则

- **事实封死**：只使用输入稿和约束卡里的事实。发现事实缺口，写"需回到 explainer 调研"，不要自行断言。
- **戏码不拔**：必须读取 explainer 戏码地图里的原型选择；润色可以换台词和具体物件，不能换原型本身的核心失败和"演时小心"。
- **先审再改**：先做编辑审稿，引用原文定位问题，再按问题润色。
- **去破壁**：把"这就是 X""本质上""第一种第二种""X 是..."尽量改成角色动作、撞墙、证据和回执。
- **产品进故事**：产品名不能只排列表；让角色拿同一个任务连续翻车、拿回执、看权限和工具清单。不要写成主角参观地图或作者导览。
- **剧情压力不断线**：后半段每个新概念也要有"误判 -> 失败证据 -> 被迫补丁/分层"的压力链；不能因为进入产品/API/兼容段就退回解释清单。
- **状态不穿帮**：不能为了好看改变原件位置、权限、状态变化和事实边界。
- **术语最后开箱**：长文/视频稿默认先让故事跑通，再集中映射真实术语。

## 输出目录

默认在当前工作目录创建：

```text
workspaces/technical-story-explainer/polisher-runs/<YYYYMMDD-HHMMSS-topic>/
  00-input-and-constraints.md
  01-editor-review.md
  02-role-world-alignment.md
  03-polish-plan.md
  04-polished-draft.md
  05-final-review-and-final.md
```

文件用途：

- `00-input-and-constraints.md`：输入文件、目标体裁、事实边界、状态边界、戏码原型清单（从 explainer 戏码地图复制）、术语映射。
- `01-editor-review.md`：独立编辑审稿，必须引用原文定位问题。
- `02-role-world-alignment.md`：**对齐 sanity-check**——核对 explainer 戏码地图能否直接用做润色舞台，不重做戏码；如果上游戏码有缺失/冲突，退回 explainer。
- `03-polish-plan.md`：逐问题润色方案 + 剧情压力链 + 扩展度目标。
- `04-polished-draft.md`：润色稿。
- `05-final-review-and-final.md`：最终审稿（含闸 4 自检证据 + 闸 7 扩展度）+ 最终稿。

如果用户只要结果，可以最终只回复 `05-final-review-and-final.md` 的路径和最终稿；但仍要创建中间文件。若环境不能写文件，按同名 Markdown 区块输出。

## 工作流

1. 读取输入稿和交接包。优先读取 `05-final-check-and-final.md` 的"润色交接包"，再读 `01-research-and-concepts.md` 的约束卡 + 戏码地图，最后读 `04-drafts.md` 的清楚稿。
2. 写 `00-input-and-constraints.md`：列出事实不能改、状态不能改、戏码原型清单（从戏码地图复制）、术语映射、目标体裁。
3. 读取 `references/polish-protocol.md`，写 `01-editor-review.md`。审稿必须指出最严重 3-7 个问题，并引用原文片段或行号。
4. 写 `02-role-world-alignment.md`：**只做 sanity-check**——核对戏码地图能否直接润色（多原型舞台一致性 / 缺失或冲突）；**不要重新选戏码或重做角色具体化**。发现戏码缺失或冲突直接退回 explainer。
5. 写 `03-polish-plan.md`：每个问题对应一个修改策略，并写出后半段的剧情压力链 + 扩展度目标；如果问题涉及事实缺口，退回 explainer，不润色。
6. 写 `04-polished-draft.md`：按对齐 sanity-check 和计划润色，不新增事实，不换戏码。
7. 读取 `references/polish-quality-gates.md`，写 `05-final-review-and-final.md`。闸不过就回到 `03-polish-plan.md` 或 `04-polished-draft.md` 修。闸 4 必须填回执清单证据；闸 7 必须给字数倍数。

## 必须退回

- 输入稿没有约束卡，且内容涉及当前产品/API/兼容/版本变化。
- 输入稿没有戏码地图，且需要润色 2 个以上概念——polisher 不重选戏码，必须 explainer 先选。
- 输入稿状态红线缺失，但润色需要改写文件、权限、工具调用、bridge、流式返回等高风险段。
- 润色计划要新增未经来源确认的产品能力。
- 润色改变了戏码核心失败，例如把"建议没有修改原件"（P13 岗位类）改成"要求打开仓库门但没开"（物理隔阂类）。
- 最终稿比原稿更好看，但改变了"谁能做什么、原件在哪里、是否执行完成、bridge 能不能创造能力"等关键事实。
- 编辑审稿只写"通过"，没有引用原文定位问题。
- 闸 4 自检证据没填，或填的是"主角看到门牌"这种参观证据。
- 闸 7 扩展度没达 1.3 倍，且没有"本段无法扩展原因"说明。

## 引用文件加载规则

| 文件 | 何时读取 |
|------|----------|
| `references/polish-protocol.md` | 每次润色前必须读取 |
| `references/polish-quality-gates.md` | 最终审稿前必须读取 |

## 常见手术

- 把定义句改成角色撞墙。
- 把产品列表改成同一任务走不同门。
- 把"兼容差异"改成退件、标红、降级、拼不上的回执。
- 把"工具调用"改成传票、执行者、回执三段。
- 把"Agent"改成任务板、权限、工具、观察、重试和交付证据。
- 把"服务器/API/接口"拆成后楼、窗口规矩、程序专用窗口。
