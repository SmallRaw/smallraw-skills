# 会话历史分析方法论

## 数据源

Claude Code 将所有会话存储为 JSONL 文件：

```
~/.claude/projects/{project-path-hash}/
├── {session-id}.jsonl        # 会话记录
├── {session-id}/             # 会话附件（可能存在）
└── ...
```

**项目路径映射规则：** 项目的实际路径 `/Users/foo/my-project` 对应目录名 `-Users-foo-my-project`（`/` → `-`）。

## JSONL 记录格式

每行是一个 JSON 对象，关键字段：

```json
{
  "type": "user|assistant|system|progress|file-history-snapshot",
  "sessionId": "uuid",
  "cwd": "/project/path",
  "gitBranch": "main",
  "timestamp": "ISO-8601",
  "message": {
    "role": "user|assistant",
    "content": "文本内容" | [{"type": "text", "text": "..."}]
  },
  "isMeta": true|false
}
```

**过滤规则：**
- `isMeta: true` → 系统元数据，跳过
- `type: "progress"` → 工具执行进度，通常跳过
- `type: "file-history-snapshot"` → 文件快照，跳过
- 文件名以 `agent-` 开头 → Agent 子会话，可选择性分析

## 分析流程

### 第一步：定位项目会话目录

```bash
# 将当前项目路径转换为目录名
# /Users/smallraw/Development/my-project → -Users-smallraw-Development-my-project
PROJECT_DIR=$(echo "$PWD" | sed 's|/|-|g')
SESSION_DIR="$HOME/.claude/projects/$PROJECT_DIR"
```

使用 Bash 工具执行：
```bash
ls -lt ~/.claude/projects/$(echo "$PWD" | sed 's|/|-|g')/*.jsonl | head -20
```

### 第二步：提取用户消息

用 Python 脚本从 JSONL 中提取用户消息（跳过 meta 和 progress），按时间排序：

```bash
python3 -c "
import json, os, glob, sys

session_dir = sys.argv[1]
files = sorted(glob.glob(os.path.join(session_dir, '*.jsonl')),
               key=os.path.getmtime, reverse=True)

# 可选：限制分析最近 N 个会话
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
files = files[:limit]

for fpath in files:
    session_id = os.path.basename(fpath).replace('.jsonl', '')
    messages = []
    with open(fpath) as f:
        for line in f:
            try:
                obj = json.loads(line)
                if obj.get('isMeta') or obj.get('type') not in ('user', 'assistant'):
                    continue
                msg = obj.get('message', {})
                content = msg.get('content', '')
                if isinstance(content, list):
                    content = ' '.join(
                        item.get('text', '') for item in content
                        if isinstance(item, dict) and item.get('type') == 'text'
                    )
                if content.strip():
                    messages.append({
                        'role': msg.get('role', ''),
                        'content': content[:500],
                        'ts': obj.get('timestamp', '')
                    })
            except: pass

    if messages:
        user_msgs = [m for m in messages if m['role'] == 'user']
        print(f'=== Session: {session_id} ({len(user_msgs)} user messages) ===')
        for m in user_msgs[:5]:  # 每个会话展示前5条
            print(f'  [{m[\"ts\"][:10]}] {m[\"content\"][:200]}')
        print()
" "\$SESSION_DIR" 10
```

### 第三步：模式分析

从提取的消息中识别以下模式：

#### A. 重复问题模式
在多个会话中出现相似的问题描述：
- 相同的错误类型被反复讨论
- 类似的"又..."、"还是..."表述
- 相同的文件/模块被反复修改

#### B. 重复指令模式
用户在不同会话中给出相同的指令：
- "用 xxx 方式做..."
- "不要..."、"记得..."
- 特定的代码风格偏好

#### C. 工作流模式
用户的工作习惯和流程：
- 常用的工具和命令
- 代码审查的关注点
- 测试策略偏好

#### D. 知识缺口
AI 反复需要用户纠正的地方：
- 项目特定的约定
- 技术栈特有的做法
- 团队内部的规范

### 第四步：生成建议

将分析结果转化为具体的规则建议：

```markdown
## 会话历史分析报告

### 分析范围
- 项目：{project_name}
- 会话数：{session_count}
- 时间跨度：{date_range}

### 发现的模式

#### 1. 重复问题（建议加入守护规则）
| 问题 | 出现次数 | 涉及会话 | 建议规则 |
|------|----------|----------|----------|
| ... | ... | ... | ... |

#### 2. 重复指令（建议加入偏好规则）
| 指令 | 出现次数 | 建议规则 |
|------|----------|----------|
| ... | ... | ... |

#### 3. 工作流洞察
- ...

#### 4. 建议的 AGENTS.md 更新
（具体的规则文本，可直接添加）
```

## 注意事项

1. **隐私尊重**：分析报告只展示模式总结，不泄露具体对话内容
2. **数据量控制**：默认分析最近 10 个会话，避免处理过多数据
3. **增量分析**：可记录上次分析时间，只分析新增会话
4. **跨项目对比**：可选择性对比同一用户不同项目的规则，找到通用规则
