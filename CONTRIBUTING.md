# Contributing Skills

如何创建和贡献新的 Skill。

---

## Skill 结构

每个 Skill 放在 `skills/<skill-name>/` 目录下：

```
skills/my-skill/
├── SKILL.md           # 必须：Skill 定义文件（含 YAML frontmatter）
├── README.md          # 可选：详细使用说明
├── knowledge/         # 可选：知识库文件
└── templates/         # 可选：模板文件
```

---

## SKILL.md 格式

```markdown
---
name: my-skill
description: 一句话描述这个 skill 做什么
metadata:
  openclaw:
    requires:
      bins: []          # 需要的命令行工具
      env: []           # 需要的环境变量
      config: []        # 需要的配置项
    homepage: https://github.com/...
user-invocable: true    # 是否可以通过 /skill-name 调用
---

# Skill 名称

[Skill 的详细说明和使用方法]
```

---

## 命名规范

- Skill 目录名：小写，用连字符分隔（如 `my-awesome-skill`）
- SKILL.md 中的 name：与目录名一致
- 描述语言：可以是中文或英文

---

## 提交流程

1. Fork 本仓库
2. 创建新分支：`git checkout -b add-my-skill`
3. 在 `skills/` 下创建你的 skill 目录
4. 添加 `SKILL.md` 和其他必要文件
5. 更新根目录的 `README.md`，在 Available Skills 表格中添加你的 skill
6. 提交 PR

---

## 质量检查清单

- [ ] SKILL.md 有正确的 YAML frontmatter
- [ ] description 简洁明了（一句话）
- [ ] 有使用示例
- [ ] 无敏感信息（API keys、密码等）
- [ ] README.md 表格已更新
