# MCP Server 只读版 — 实验记录

## 实验目标
配置一个只读 MCP server，暴露两个工具：
- `search_docs(query)` — 搜索本地项目文档
- `get_file(path)` — 读取白名单目录里的文件

## 安全要求
- 不能读白名单外路径
- 返回带来源路径
- 调用写日志
- 错误明确返回

## 实现

文件：`experiments/mcp-server/mcp-server.js`

技术选择：
- 语言：Node.js（无需额外依赖）
- 传输：stdio（标准 MCP 协议）
- 白名单：`experiments/` + `ai-web3-school-cohort-0/` 两个目录
- 日志：JSON Lines 格式，写到 `mcp-server.log`

### 安全机制

1. **路径白名单校验** — `isPathAllowed()` 检查 resolved path 是否以白名单目录开头
2. **禁止目录读取** — `get_file` 拒绝目录路径
3. **文件大小限制** — 最大 1MB
4. **跳过 node_modules 和隐藏目录** — search_docs 不进入
5. **调用日志** — 每次工具调用记录 timestamp/level/message/data

### 测试结果

| 测试 | 结果 |
|------|------|
| initialize | ok |
| tools/list (2 tools) | ok |
| search_docs("RAG") | 34 results returned |
| get_file(白名单内文件) | 返回 content + size |
| get_file(白名单外路径) → ACCESS_DENIED | blocked |
| get_file(不存在路径) → NOT_FOUND | blocked |
| get_file(目录路径) → IS_DIRECTORY | blocked |

## Hermes 配置

在 `~/.hermes/config.yaml` 中添加：

```yaml
mcp_servers:
  docs:
    command: "node"
    args: ["/home/emptytouch/ai-web3-school-cohort-0/experiments/mcp-server/mcp-server.js"]
    timeout: 30
```

重启 Hermes 后工具以 `mcp_docs_search_docs` / `mcp_docs_get_file` 命名自动可用。

## 状态：完成

## 复盘

### 做对了什么
- 安全边界清晰（白名单 + 路径校验 + 大小限制 + 类型检查）
- 日志完整（每次调用记录，方便审计）
- 零依赖（纯 Node.js，不需要 mcp SDK 也能跑 stdio 协议）

### 可以改进
- 当前是线性搜索，文件多了会慢 → 后续可加索引
- 没有做内容过滤（比如二进制文件可能读到乱码）
- 日志没有轮转，长时间运行会变大

### MCP 协议理解加深
- MCP server 本质就是 stdio 上的 JSON-RPC：读 stdin 行，解析请求，写 stdout 响应
- initialize 握手 → tools/list 发现 → tools/call 执行，流程很清晰
- 不需要 MCP SDK 也能手写一个最小 server，SDK 帮你处理的是连接管理和重试
