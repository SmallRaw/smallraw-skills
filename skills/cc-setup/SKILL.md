---
name: cc-setup
description: "User types /cc-setup to interactively configure Claude Code settings — skill usage logging hook, HUD statusLine, and future extensions."
user-invocable: true
disable-model-invocation: true
---

# Claude Code 配置向导

交互式配置 Claude Code 的 hooks、HUD 等设置。每个配置项独立，可单独开关或重新设置。

## 核心规则

1. **先检测再提问**。每个配置项先读取当前状态（已开启/已关闭/未配置），展示给用户后再问是否修改
2. **问作用域**。每个配置项都要问：项目级（`.claude/settings.local.json`）还是全局级（`~/.claude/settings.json`）
3. **合并不覆盖**。写入 settings 时必须 merge 现有内容，不能丢失已有配置
4. **脚本能做的不用 AI**。hook command 用纯 bash/jq，不消耗 token

## 配置项

启动后依次询问以下配置项（用户可跳过任何一项）：

### 1. Skill 调用日志

监听 `Skill` 工具调用，记录每次使用的 skill 名称和时间。

**检测**：检查目标 settings 中是否存在 `hooks.PostToolUse` 中 matcher 为 `Skill` 的 hook

**开启时写入的 hook**：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"[\" + (now | strftime(\"%Y-%m-%d %H:%M\")) + \"] \" + .tool_input.skill' >> ~/.claude/skill-usage.log 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

**日志位置**：`~/.claude/skill-usage.log`

### 2. HUD 状态栏

配置 statusLine 显示项目路径、git 分支、模型、上下文用量、费用。

**检测**：检查目标 settings 中是否存在 `statusLine` 配置

**开启时**：将 `scripts/statusline.sh` 的路径写入 `statusLine.command`

**关闭时**：删除 `statusLine` 字段

## Gotchas

1. **settings.json 语法错误会静默禁用所有设置**。修改后必须 `jq -e . <file>` 验证
2. **项目级 `.claude/settings.local.json` 不会自动 gitignore**。首次创建时检查 `.gitignore`
3. **hook 修改后需要重启 session 或打开 `/hooks` 才生效**。完成后提醒用户
4. **合并 hooks 数组时注意去重**。同一个 event+matcher 不要重复添加
5. **statusLine script 路径必须是绝对路径**。不能用相对路径或 `~`

## 交互流程

```
1. 读取当前 settings（项目级 + 全局级）
2. 对每个配置项：
   a. 显示当前状态（✅ 已开启 / ❌ 未配置）
   b. 问：开启/关闭/跳过？
   c. 如果要修改，问：项目级还是全局级？
   d. 执行修改，验证 JSON
3. 汇总所有变更
4. 提醒用户重启 session 或 /hooks 刷新
```
