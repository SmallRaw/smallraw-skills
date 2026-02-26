---
name: excel-analyst
description: Excel 报表分析、数据清洗与导出。处理复杂/乱序报表（表头不在首行、合并单元格、各种脏字符均自动处理）。当用户需要读取、查询、分析、清洗 Excel/xlsx/xls 文件，或需要对报表数据做批量替换、去重、聚合、筛选、新增计算列、透视、导出新文件时触发。不修改原始文件，结果导出为新的 .xlsx/.csv/.json。不用于从零创建 Excel 或原地编辑 Excel。
---

# Excel 报表分析与数据清洗

读取 Excel → 自动清洗脏字符 → 查询/清洗/加工 → 导出新文件。不修改原始文件。

## 强制规则

1. 禁止用 Read 工具读取 .xlsx/.xls（乱码）
2. 用户给了文件路径就直接用，不要 Glob 搜索
3. 所有 Excel 读取通过 `scripts/excel_tool.py`
4. 保存配置和规则文件用 Write 工具

## 不确定该做什么？直接执行 auto

```bash
python scripts/excel_tool.py auto <文件路径>
```

工具会自动检测当前状态（有无 config、有无 steps）并输出推荐配置和下一步的完整命令。

## 命令速查

```bash
python scripts/excel_tool.py scout <文件> -n 8                           # 侦察原始结构
python scripts/excel_tool.py auto <文件> headers --sheet "Sheet名"        # 查看列名
python scripts/excel_tool.py auto <文件> preview -n 5 --sheet "Sheet名"   # 预览数据
python scripts/excel_tool.py auto <文件> query --sheet "Sheet名" \
  --where-col "列名" --where-op ">" --where-val "100" -s "desc:列名" -t 10  # 条件查询
python scripts/excel_tool.py clean <文件> --preview --sheet "Sheet名"     # 预览清洗
python scripts/excel_tool.py clean <文件> -o out.xlsx --sheet "Sheet名"   # 导出
python scripts/excel_tool.py export <文件> -o data.csv --sheet "Sheet名"  # 导出干净 csv
python scripts/excel_tool.py help                                        # 查看所有操作
python scripts/excel_tool.py help <操作名>                                # 查看操作格式
python scripts/excel_tool.py help custom-scripts                         # 自定义脚本指南
```

执行前先 `cd` 到本 skill 目录（即包含此 SKILL.md 的目录）。

## 文件约定

| 文件 | 用途 |
|------|------|
| `xxx.excel-config.json` | 结构配置（auto 命令自动生成推荐，用 Write 保存即可） |
| `xxx-操作描述.excel-steps.json` | 清洗步骤（steps 数组，clean 无 steps 时工具输出格式参考） |

两类文件放在 Excel 同目录下，由工具自动发现。

## 工作流

1. **执行 auto** → 无 config 时工具输出侦察结果和推荐配置 → 用 Write 保存 → 重新执行
2. **auto headers/preview/query** → 自由探索数据
3. **clean** → 无 steps 时工具输出可用操作和格式 → 编写 steps JSON 保存 → `--preview` 确认 → `-o` 导出
4. 内置操作不够？→ `help custom-scripts` 查看指南 → `export` 导出 csv → 写自定义 Python 脚本

每一步工具都会输出带绝对路径的下一步命令，照着执行即可。

## 内置清洗操作（13 种）

trim, replace, fill_empty, dedup, filter, regex_replace, add_column, drop_columns, sort, aggregate, rename, type_convert, pivot

用 `help <操作名>` 按需查看格式，不需要提前记住。

## 省 Token

- `--sheet` 指定单个 Sheet，多 Sheet 时必须指定
- `-t` 控制输出条数（默认 10），`-c` 只选需要的列
- 先 `--preview` 确认，再 `-o` 导出
