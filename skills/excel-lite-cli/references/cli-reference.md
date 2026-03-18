# CLI 命令速查

## 命令概览

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

## 常用参数

| 参数 | 作用 |
|------|------|
| `--sheet "Sheet名"` | 指定 Sheet（多 Sheet 时必须） |
| `-n` | 控制预览行数 |
| `-t` | 控制查询输出条数（默认 10） |
| `-c` | 只选需要的列（逗号分隔） |
| `-s` | 排序，降序用 `desc:列名` |
| `-o` | 输出文件路径（.csv/.json/.xlsx） |
| `--preview` | 预览清洗结果，不导出 |
