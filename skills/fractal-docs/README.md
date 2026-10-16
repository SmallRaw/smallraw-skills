# /fractal-docs — 模块知识维护

保存修改模块前需要知道、又不容易从代码看出的原因和取舍。沿用现有 README，必要时新增 MODULE.md；不要求每个目录建文档或每个文件补三行头注释。

```text
/fractal-docs init                    # 为需要说明的模块建立最少文档和入口
/fractal-docs update --base <提交>    # 核对本次任务已提交和未提交的变更
/fractal-docs check                   # 核对已有知识与依据
```

项目共用指令留在 AGENTS.md / CLAUDE.md，模块说明放普通 Markdown，源码和测试表达具体行为。模块文档只保留当前有效的认识，详细变更历史由 Git 保存。

现有分形文档和头注释继续兼容；不会自动清理用户指令、批量迁移文件或新建协议文件。模块知识可以覆盖多个目录，入口链接到同一份说明。

## 工具可选

普通文件读取、`rg`、Git 和项目测试就能使用与维护这些文档。可选只读 CLI `fractal-context` 支持模块导航、Markdown 正文读取和内容搜索，不创建或修改项目文件：

```bash
fractal-context list src --depth 2
fractal-context read src/parser/MODULE.md
fractal-context search parser
```

CLI 的本地构建和用法见 [fractal-context-cli](../../packages/fractal-context-cli/README.md)。文档本身不依赖安装它。
