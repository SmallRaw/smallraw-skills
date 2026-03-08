# mcp-utils Daemon Mode Design

## Problem

mcp-utils 当前每次调用都是独立连接（用完即断）。对于有状态的 MCP server（如设计工具、Chrome DevTools），连接断开后会丢失会话上下文。需要支持连接保持。

## Solution: Hybrid Mode (方案 C)

保持现有直连架构不变，只对 `lifecycle: "keep-alive"` 的 server 通过 daemon 进程保持连接。

## Registry 配置

在 `mcp-registry.json` 的 server 条目中加 `lifecycle` 字段：

```json
{
  "servers": {
    "pencil": {
      "description": "设计工具",
      "when": "需要操作设计稿时",
      "lifecycle": "keep-alive",
      "transport": { "type": "stdio", "target": "/path/to/pencil", "args": ["--app", "desktop"] },
      "tools": [{ "name": "get_editor_state", "description": "获取编辑器状态" }]
    },
    "some-api": {
      "description": "查数据的 API",
      "when": "需要查数据时",
      "transport": { "type": "http", "target": "http://localhost:3000/mcp" },
      "tools": [{ "name": "query", "description": "查询" }]
    }
  }
}
```

- `"lifecycle": "keep-alive"` — 走 daemon，连接保持
- `"lifecycle": "ephemeral"` 或不写 — 现有行为，用完即断

## Architecture

```
CLI 调用 ephemeral server → 直连（现有逻辑，不变）

CLI 调用 keep-alive server → 检查 daemon
  → daemon 没跑 → fork 启动 daemon → 等待就绪
  → daemon 在跑 → 通过 Unix socket 发请求
  → daemon 无响应 → 重启 daemon → 发请求
```

## Daemon Process

- **IPC**: Unix socket (`~/.mcp-utils/daemon-<hash>.sock`)
- **启动**: CLI 发现目标 server 是 keep-alive 且 daemon 没跑时，`spawn` detached 子进程
- **metadata**: `~/.mcp-utils/daemon-<hash>.json` 记录 pid、socket 路径、启动时间
- **连接池**: 按 server name 维护 MCP client 实例，首次请求时连接，之后复用
- **空闲回收**: 每 30 秒检查，超过 5 分钟没用的 server 断开（但不停 daemon）
- **停止**: `mcp-utils daemon stop`、SIGTERM/SIGINT、或所有 server 都被回收后自动退出

## Protocol

```typescript
// Request
interface DaemonRequest {
  id: string;
  method: 'callTool' | 'listTools' | 'listResources' | 'readResource'
        | 'listPrompts' | 'getPrompt' | 'serverInfo' | 'status' | 'stop';
  params: Record<string, unknown>;
}

// Response
interface DaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}
```

## New CLI Commands

```bash
mcp-utils daemon start       # 手动启动 daemon
mcp-utils daemon stop        # 停止 daemon
mcp-utils daemon status      # 查看 daemon 状态和连接信息
```

## File Structure

```
packages/mcp-utils/src/
  index.ts              # CLI 入口（判断 lifecycle 分流）
  daemon/
    protocol.ts         # 请求/响应类型定义
    paths.ts            # socket、metadata 文件路径
    host.ts             # daemon 进程主体（net.createServer + 连接池）
    client.ts           # CLI 端 daemon 客户端（连接 socket、自动启动）
    launch.ts           # fork daemon detached 子进程
```

## Impact on Existing Code

- `ServerEntry` 类型加 `lifecycle?: "keep-alive" | "ephemeral"` 字段
- `main()` 判断目标 server 的 lifecycle，分流到直连或 daemon client
- `mcp-registry.schema.json` 加 lifecycle 字段
- ephemeral 路径完全不变，零影响

## Reference

参考 [mcporter](https://github.com/steipete/mcporter) 的 daemon 设计：
- Unix socket IPC
- detached 子进程 + metadata 文件
- config stale 检测（配置变更自动重启）
- idle server 回收
