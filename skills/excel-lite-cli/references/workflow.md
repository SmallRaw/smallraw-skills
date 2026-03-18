# 工作流

## 标准流程

1. **auto headers/preview** — 自动检测结构，直接探索数据
2. **auto query** — 条件查询
3. **clean** — 无 steps 时工具输出可用操作和格式 → 编写 steps JSON 保存 → `--preview` 确认 → `-o` 导出
4. 内置操作不够？→ `help custom-scripts` 查看指南 → `export` 导出 csv → 写自定义 Python 脚本

每一步工具都会输出带绝对路径的下一步命令，照着执行即可。

## 文件约定

| 文件 | 用途 |
|------|------|
| `xxx-操作描述.excel-steps.json` | 清洗步骤（steps 数组，clean 无 steps 时工具输出格式参考） |

规则文件放在 Excel 同目录下，由工具自动发现。

## 内置清洗操作（13 种）

trim, replace, fill_empty, dedup, filter, regex_replace, add_column, drop_columns, sort, aggregate, rename, type_convert, pivot

用 `help <操作名>` 按需查看格式，不需要提前记住。
