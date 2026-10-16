---
name: fractal-docs
description: 当用户请求初始化、更新或检查项目的模块知识文档时使用；复用 README.md 或 MODULE.md，兼容已有分形文档。
license: MIT
metadata:
  homepage: https://github.com/smallraw/smallraw-skills
  author: smallraw
user-invocable: true
disable-model-invocation: true
---

# /fractal-docs — 模块知识维护

留下修改模块前需要知道、又不容易从代码看出的知识：必要的运行流程、非显然的约束、设计取舍及其原因。Git 保存变更历史，测试验证行为，模块文档保存当前仍有效的认识。

## 放在哪里

- 优先复用模块已有 `README.md`；需要独立说明时使用 `MODULE.md`。一个模块只维护一份主要说明，不要求每个目录都有文档。
- 横跨多个目录的模块，可以沿用项目的 `docs/` 组织方式；在说明中写明覆盖范围，从现有项目入口链接过去，不复制多份。
- `AGENTS.md` / `CLAUDE.md` 留给项目指令。保留用户已有规则、引用和软链接；必要时只追加一条相关文档的阅读提示，不用模块介绍覆盖它们。
- 源码注释和测试已表达清楚的内容不重复写。已有 INPUT/OUTPUT/POS 可继续维护，不要求全文件补齐。
- 已有 `FRACTAL-DOCS.md` 和目录级 `AGENTS.md` 可继续使用；不默认创建协议文件，也不自动批量改名或删除旧文件。

## 写什么

用能帮助下次修改的最短表述，参考 [模块示例](starter/module.starter.md)，无需照搬所有章节：

- 必要的范围、主流程和入口；复杂交互才画流程图，不展开逐函数调用清单。
- 容易误改的行为或取舍、原因，以及什么条件改变后可以重新考虑。
- 验证和历史依据：链接代码、测试、修复 commit / issue，或注明条件的性能测量。不要把每个 commit 再抄进文档。

原因必须有依据，不能从当前实现反推一段虚构历史。无法确认但会影响修改判断的内容，明确标为待核实，并带着已查到的证据询问用户；普通文件职责可据代码直接整理。

## 维护方式

按本次请求读取对应说明即可：

| 请求 | 说明 |
|---|---|
| `init`：选择需要记录的模块，建立最少入口 | [prompts/init.md](prompts/init.md) |
| `update [路径] [--base 提交或分支]`：核对一次任务范围内的变更 | [prompts/update.md](prompts/update.md) |
| `check [路径]`：检查已有知识是否仍有依据 | [prompts/check.md](prompts/check.md) |

内部重构、配置变化、性能优化也可能使说明失效；判断依据是文档中的事实是否改变，不是接口是否改变。一次任务结束后核对相关模块，事实未变就不改文档，不逐 commit 追加记录。

## 工具可选

普通文件读取、`rg`、Git 和项目测试即可完成全部维护。文档必须通过普通路径和链接独立使用，不依赖 CLI、索引数据库或专用加载协议。

如已安装 `fractal-context`，可用它辅助只读导航：

```bash
fractal-context list src --depth 2
fractal-context read src/parser/MODULE.md
fractal-context search parser
```

仅在维护已有三行头注释时查 [语言格式参考](knowledge/header-patterns.md)。需要在现有根指令里补入口时参考 [阅读提示](starter/root-agents.starter.md)。只有明确需要独立维护约定时才参考 [可选约定](starter/fractal-protocol.starter.md)。
