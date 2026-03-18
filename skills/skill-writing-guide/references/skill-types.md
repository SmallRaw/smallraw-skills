# 9 类 Skill 分类体系

来源：Anthropic 内部 skill 实战经验。好的 skill 应该干净地落在其中一类；跨多类的 skill 通常意味着需要拆分。

---

## 1. Library & API Reference — 库/API 参考类

解决内部库或 Claude 容易用错的外部库问题。

**核心内容**：代码片段文件夹 + 踩坑清单（gotchas）

**典型示例**：
- `billing-lib` — 内部计费库的 edge case 和 footgun
- `internal-platform-cli` — 内部 CLI 的所有子命令 + 使用场景示例
- `frontend-design` — 让 Claude 更好地使用你们的设计系统（如避免 Inter 字体 + 紫色渐变等默认审美）

---

## 2. Product Verification — 产品验证类

描述如何测试/验证代码是否正常工作，通常配合 Playwright、tmux 等外部工具。

**关键实践**：
- 值得投入工程师花一周打磨验证类 skill
- 让 Claude 录制测试视频，方便回看实际测试了什么
- 在每个步骤加程序化断言（programmatic assertions）
- 通常包含多个脚本文件

**典型示例**：
- `signup-flow-driver` — 在 headless browser 中跑注册→邮件验证→引导流程，每步断言状态
- `checkout-verifier` — 用 Stripe 测试卡走完结账流程，验证发票状态
- `tmux-cli-driver` — 需要 TTY 的交互式 CLI 测试

---

## 3. Data Fetching & Analysis — 数据获取与分析类

连接数据和监控栈，包含凭证、dashboard ID、常见查询工作流。

**核心内容**：数据获取库 + 凭证配置 + 常见工作流说明

**典型示例**：
- `funnel-query` — 注册→激活→付费的事件 join 方式 + canonical user_id 所在表
- `cohort-compare` — 对比两个 cohort 的留存/转化，标记统计显著性差异
- `grafana` — datasource UID、集群名、"出了什么问题→看哪个 dashboard"的查找表

---

## 4. Business Process & Team Automation — 业务流程自动化类

把重复的团队工作流压缩为一条命令。通常指令简单但依赖其他 skill 或 MCP。

**技巧**：保存执行日志可帮助模型保持一致性并反思历史执行结果。

**典型示例**：
- `standup-post` — 聚合工单系统 + GitHub 活动 + 前日 Slack → 格式化日报，只展示增量
- `create-<ticket-system>-ticket` — 强制 schema 校验 + 创建后自动 ping reviewer、关联 Slack
- `weekly-recap` — 合并的 PR + 关闭的工单 + 部署 → 格式化周报

---

## 5. Code Scaffolding & Templates — 代码脚手架类

为特定代码模式生成框架模板。特别适合有自然语言要求（代码模板无法完全覆盖）的场景。

**典型示例**：
- `new-<framework>-workflow` — 用你们的注解生成新的 service/workflow/handler
- `new-migration` — 迁移文件模板 + 常见踩坑点
- `create-app` — 新应用脚手架，预配置 auth、logging、deploy

---

## 6. Code Quality & Review — 代码质量与审查类

在组织内强制代码质量标准，帮助代码审查。可结合 hooks 或 GitHub Action 自动运行。

**典型示例**：
- `adversarial-review` — spawn 一个"新视角"子 agent 做批评式审查，修复发现的问题，迭代直到只剩 nitpick
- `code-style` — 强制代码风格，尤其是 Claude 默认做不好的风格
- `testing-practices` — 如何写测试、测什么的指导

---

## 7. CI/CD & Deployment — CI/CD 与部署类

帮助获取代码状态、推送和部署。可能引用其他 skill 来收集数据。

**典型示例**：
- `babysit-pr` — 监控 PR → 自动重试 flaky CI → 解决合并冲突 → 启用 auto-merge
- `deploy-<service>` — 构建 → 冒烟测试 → 灰度流量发布（对比错误率）→ 回归时自动回滚
- `cherry-pick-prod` — 隔离 worktree → cherry-pick → 解决冲突 → 用模板创建 PR

---

## 8. Runbooks — 运维手册类

从症状（Slack 线程、告警、错误签名）出发，走多工具调查流程，输出结构化报告。

**典型示例**：
- `<service>-debugging` — 高流量服务的 症状→工具→查询模式 映射
- `oncall-runner` — 抓取告警 → 排查常见原因 → 格式化报告
- `log-correlator` — 给定 request ID，从所有可能经过的系统拉取匹配日志

---

## 9. Infrastructure Operations — 基础设施运维类

执行例行维护和运维操作，部分涉及破坏性操作，需要设置护栏。

**典型示例**：
- `<resource>-orphans` — 找到孤立 pod/volume → 发 Slack → 等待 soak period → 用户确认 → 级联清理
- `dependency-management` — 组织内的依赖审批工作流
- `cost-investigation` — "为什么存储/出口费用飙升"+ 具体 bucket 和查询模式
