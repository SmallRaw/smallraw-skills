# Skill 分发与管理

## 两种分发方式

### 1. Repo 内 Check-in

把 skill 放在 `./.claude/skills` 目录下，随代码库一起版本管理。

- **适用**：小团队、少量 repo
- **注意**：每个 check-in 的 skill 都会增加模型的 context 开销

### 2. 插件市场（Plugin Marketplace）

通过 Claude Code Plugin 市场上传和安装，用户按需选择。

- **适用**：大团队、跨 repo 分发
- **优势**：用户自行决定安装哪些，避免 context 膨胀

## 市场管理策略

Anthropic 内部的做法——**不设中央审批团队**，让好的 skill 有机涌现：

1. **沙盒试用**：作者上传到 GitHub 沙盒文件夹，在 Slack 等渠道分享让同事试用
2. **有了 traction 再正式上架**：由 skill 作者自行判断时机，提 PR 迁入市场
3. **必须有筛选机制**：很容易产生质量低下或重复的 skill，正式发布前需要某种 curation

## Skill 组合（Composing Skills）

- 原生依赖管理暂不支持
- 实践方式：在 skill 中按名称引用另一个 skill，模型会在已安装的情况下自动调用
- **务必在文档中声明依赖**，避免未安装时静默失败

## 度量 Skill 使用情况

- 使用 `PreToolUse` hook 记录 skill 调用日志
- 可以发现：哪些 skill 受欢迎、哪些触发率低于预期
- Anthropic 提供了示例代码（详见官方文档）
