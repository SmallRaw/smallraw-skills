---
name: excel-lite-cli
description: Excel/xlsx/xls 报表分析、数据清洗与导出。自动处理复杂报表（表头不在首行、合并单元格、脏字符）。用户提到任何 Excel 文件的读取、查询、分析、清洗或导出时必须触发——禁止用 Read 工具直接读 xlsx（会乱码）。不修改原始文件，结果导出为新文件。
user-invocable: false
disable-model-invocation: false
---

# Excel 报表分析与数据清洗

读取 Excel → 自动检测结构 → 自动清洗脏字符 → 查询/清洗/加工 → 导出新文件。不修改原始文件。

## 核心规则

1. **禁止用 Read 工具读 .xlsx/.xls** — 二进制文件会乱码，所有读取必须走 `scripts/excel_tool.py`
2. **用户给了路径就直接用** — 不要 Glob 搜索文件
3. **不确定做什么就跑 auto** — `python scripts/excel_tool.py auto <文件路径>` 自动检测结构
4. **保存规则文件用 Write 工具** — steps JSON 用 Write 写入，不要用 Bash echo
5. **执行前先 cd 到 skill 目录** — 即包含此 SKILL.md 的目录

## Gotchas

1. **多 Sheet 必须 `--sheet`** — 不指定时，query/clean 会报错退出；只有单 Sheet 才会自动选择
2. **先 `--preview` 再 `-o`** — clean 不加 `--preview` 也不加 `-o` 时只打格式提示，不执行清洗
3. **`-t` 控制输出条数** — 默认 10 条，大表不加 `-t` 会截断；`-c` 只选需要的列，避免大量列撑爆输出
4. **steps JSON 格式严格** — 缺 `action` 字段、拼错操作名、漏必填参数都会被校验拦截，看报错提示修
5. **规则文件命名必须含 `.excel-steps.json`** — 否则 clean 自动发现找不到，要手动传路径
6. **scout 看原始结构，auto 看清洗后结构** — 排查表头检测错误时用 scout，日常用 auto
7. **数值列自动转数值比较** — query/filter 的 `>` `<` 等运算符对数值列生效，字符串列走字符串匹配
8. **export 导出的是干净数据** — 已经过自动检测+脏字符清洗，可直接给自定义 Python 脚本用

## 极简用法

```bash
python scripts/excel_tool.py auto <文件>                    # 自动检测 + 预览
python scripts/excel_tool.py auto <文件> query --sheet "X" --where-col "列" --where-op ">" --where-val "100"
python scripts/excel_tool.py help                           # 查看所有清洗操作格式
```

## 详细参考

- [CLI 完整命令](references/cli-reference.md) — 全部命令、参数速查
- [工作流与清洗操作](references/workflow.md) — 标准流程、文件约定、13 种内置操作列表
