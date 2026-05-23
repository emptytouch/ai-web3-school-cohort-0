# Web3 Tool Use — Tool Schema 设计

## 设计目标

为交易解释器 Agent 设计一套 Web3 链上工具的 tool schema。
这些工具让 Agent 能主动查询链上数据，而不是依赖预填充的上下文。

设计原则：
1. **只读优先** — 工具集默认只读，写入类工具（sendTransaction）单独标记 high-risk
2. **参数校验严格** — Agent 容易搞错 decimals / wei / address 格式，schema 要防错
3. **返回结构化** — 同时返回 raw + human 格式，减少模型处理大数的负担
4. **错误明确** — 每种错误情况有明确 error code

---

## 工具清单

| # | 工具名 | 对应 RPC | 类型 | 风险 |
|---|--------|---------|------|------|
| T1 | eth_getBalance | eth_getBalance | 只读 | 无 |
| T2 | eth_call | eth_call | 只读 | 无 |
| T3 | eth_getTransactionByHash | eth_getTransactionByHash | 只读 | 无 |
| T4 | eth_getTransactionReceipt | eth_getTransactionReceipt | 只读 | 无 |
| T5 | eth_estimateGas | eth_estimateGas | 只读 | 无 |
| T6 | eth_getCode | eth_getCode | 只读 | 无 |
| T7 | eth_blockNumber | eth_blockNumber | 只读 | 无 |
| T8 | alchemy_simulate | Alchemy simulateAssetChanges | 只读 | 无 |
| T9 | eth_sendRawTransaction | eth_sendRawTransaction | 写入 | high |

---

## T1: eth_getBalance — 查询账户余额

```jsonc
{
  "name": "eth_getBalance",
  "description": "查询任意地址的 ETH 或原生代币余额。返回 wei 和 human-readable 两种格式。注意：这不是代币余额，代币余额请用 eth_call 读取 ERC-20 balanceOf。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "address": {
        "type": "string",
        "description": "要查询的地址，必须是合法的以太坊地址（0x 开头 + 40 hex 字符）。示例：0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
      },
      "block": {
        "type": "string",
        "description": "查询的区块号。可以是 'latest'（默认）、'pending'、'earliest'、或具体区块号如 '0x12D4B0'。默认 latest。"
      }
    },
    "required": ["address"],
    "examples": [
      {"address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28"},
      {"address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28", "block": "latest"}
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "balance_wei": "1000000000000000000",
  "balance_human": "1.0 ETH",
  "block_queried": "latest",
  "error": null
}
```

**错误处理**：
| 错误 | code | 说明 |
|------|------|------|
| 地址格式无效 | INVALID_ADDRESS | 不是合法地址 |
| RPC 查询失败 | RPC_ERROR | 节点不可用 |

---

## T2: eth_call — 调用合约只读方法

```jsonc
{
  "name": "eth_call",
  "description": "调用合约的只读方法（不发送交易，不消耗 gas）。用于查询代币余额、授权额度、合约状态等。注意：返回的是 ABI 编码的 raw data，需要配合 decode 使用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "to": {
        "type": "string",
        "description": "合约地址。示例：0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48（USDC）"
      },
      "data": {
        "type": "string",
        "description": "ABI 编码的 calldata。可以用工具辅助生成，或直接传 function signature + 参数。示例：0x70a08231000000000000000000000000AB...CD（balanceOf）"
      },
      "block": {
        "type": "string",
        "description": "执行区块，默认 latest"
      },
      "from": {
        "type": "string",
        "description": "msg.sender 模拟地址。可选，默认零地址。用于需要特定身份才能返回正确结果的视图函数。"
      }
    },
    "required": ["to", "data"],
    "examples": [
      {
        "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "data": "0x70a08231000000000000000000000000abc123...def"
      }
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "raw": "0x000000000000000000000000000000000000000000000000000000001dcd6500",
  "decoded": {
    "type": "uint256",
    "value_raw": "500000000",
    "value_human": "500.0"
  },
  "error": null
}
```

**错误处理**：
| 错误 | code | 说明 |
|------|------|------|
| 合约不存在 | NO_CODE | to 地址没有合约代码 |
| 调用 revert | CALL_FAILED | 附带 revert reason |
| calldata 格式错误 | INVALID_DATA | data 不是合法 ABI |

---

## T3: eth_getTransactionByHash — 获取交易详情

```jsonc
{
  "name": "eth_getTransactionByHash",
  "description": "根据交易哈希获取交易的完整信息。用于分析一笔已经广播或已确认的交易。如果交易还未上链返回 null。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tx_hash": {
        "type": "string",
        "description": "交易哈希（0x 开头 + 64 hex 字符）。示例：0xabc123...def456"
      }
    },
    "required": ["tx_hash"],
    "examples": [
      {"tx_hash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"}
    ]
  }
}
```

**返回格式**：（按 Chain-aware Context transaction 结构返回，参见 chain-aware-context-schema.md 第三层）

---

## T4: eth_getTransactionReceipt — 获取交易收据

```jsonc
{
  "name": "eth_getTransactionReceipt",
  "description": "获取交易收据。包含执行状态、gas 使用量、事件日志等。只有已确认的交易才有收据。事件日志可用 decodeEvents 参数自动解码。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tx_hash": {
        "type": "string",
        "description": "交易哈希"
      },
      "decode_events": {
        "type": "boolean",
        "description": "是否自动解码事件日志。默认 true。如果为 true，将尝试使用已知 ABI 解码 topics 和 data。",
        "default": true
      }
    },
    "required": ["tx_hash"],
    "examples": [
      {"tx_hash": "0x1234567890abcdef...", "decode_events": true}
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "status": "success",               // success | failed
  "gas_used": "156432",
  "effective_gas_price": "25000000000",
  "cost_wei": "3910800000000000",
  "cost_human": "0.0039108 ETH",
  "logs": [
    {
      "address": "0xA0b8...48",
      "event_name": "Transfer",
      "params": {
        "from": "0xUSER...ADDR",
        "to": "0xSWAP...ROUTER",
        "value": "100000000"
      }
    }
  ],
  "logs_raw": [...],                // 未解码的原始 logs（兜底）
  "error": null
}
```

---

## T5: eth_estimateGas — 估算 gas

```jsonc
{
  "name": "eth_estimateGas",
  "description": "估算一笔交易将消耗的 gas。模拟执行但不上链。可能失败（如果交易会 revert）。返回估算值和与用户设定 gas limit 的对比。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from": {"type": "string", "description": "发送地址"},
      "to": {"type": "string", "description": "目标地址"},
      "value": {"type": "string", "description": "发送的 ETH 量（wei 格式）", "default": "0"},
      "data": {"type": "string", "description": "交易 calldata"},
      "gas_limit_user_set": {
        "type": "string",
        "description": "用户设置的 gas limit（可选）。如果提供，返回时将对比估算值和设定值的比例。"
      }
    },
    "required": ["from", "to"],
    "examples": [
      {"from": "0xUSER...ADDR", "to": "0xA0b8...48", "data": "0x095ea7b3..."}
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "gas_estimate": "65000",
  "gas_estimate_hex": "0xfde8",
  "confidence": "high",              // high | medium | low
  "ratio_to_user_limit": null,       // 如果传了 gas_limit_user_set
  "warnings": [],                    // gas 异常时的警告
  "error": null
}
```

---

## T6: eth_getCode — 检查合约代码

```jsonc
{
  "name": "eth_getCode",
  "description": "检查一个地址是否有合约代码。用于区分 EOA（普通账户）和合约。返回空字符串表示 EOA。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "address": {"type": "string", "description": "要检查的地址"},
      "block": {"type": "string", "description": "区块号，默认 latest"}
    },
    "required": ["address"],
    "examples": [
      {"address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28"}
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "address": "0xAB...CD",
  "is_contract": true,
  "code_size_bytes": 12345,
  "code_hash": "0x...",              // code keccak256 hash
  "error": null
}
```

---

## T7: eth_blockNumber — 当前区块号

```jsonc
{
  "name": "eth_blockNumber",
  "description": "获取当前最新区块号。简单快捷，用于检查数据时效性和估算确认时间。",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": [],
    "examples": [{}]
  }
}
```

**返回格式**：
```jsonc
{
  "block_number": 19876543,
  "block_number_hex": "0x12F4B3F",
  "timestamp": 1716000000,
  "error": null
}
```

---

## T8: alchemy_simulate — 交易模拟（增强版）

```jsonc
{
  "name": "alchemy_simulate",
  "description": "使用 Alchemy 的 simulateAssetChanges API 模拟交易执行。返回预估的资产变化、事件日志、gas 估算。这是最强的只读分析工具——在执行前预测交易结果。需要 Alchemy API key。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from": {"type": "string", "description": "发送者地址"},
      "to": {"type": "string", "description": "目标地址/合约"},
      "value": {"type": "string", "description": "ETH 发送量（wei）", "default": "0"},
      "data": {"type": "string", "description": "交易 calldata"},
      "block": {"type": "string", "description": "模拟基于的区块，默认 latest"},
      "include_events": {
        "type": "boolean",
        "description": "是否包含事件解码",
        "default": true
      }
    },
    "required": ["from", "to"],
    "examples": [
      {"from": "0xUSER...", "to": "0xUNISWAP...", "data": "0x...swapExactTokensForTokens"}
    ]
  }
}
```

**返回格式**：
```jsonc
{
  "status": "success",               // success | failed
  "error": null,
  "gas_used": "185000",
  "gas_estimate": "200000",
  "asset_changes": [
    {
      "direction": "out",
      "asset": "USDC",
      "amount": "1000.0",
      "amount_wei": "1000000000",
      "from": "0xUSER...ADDR",
      "to": "0xPOOL...ADDR"
    },
    {
      "direction": "in",
      "asset": "WETH",
      "amount": "0.52",
      "amount_wei": "520000000000000000",
      "from": "0xPOOL...ADDR",
      "to": "0xUSER...ADDR"
    }
  ],
  "events": [...],                  // 解码后的事件日志
  "internal_transfers": [...]        // ETH 内部转账
}
```

---

## T9: eth_sendRawTransaction — 发送交易（写入类）

```jsonc
{
  "name": "eth_sendRawTransaction",
  "description": "发送一笔已签名的原始交易上链。⚠️ 这是写入操作 — 会改变链上状态并消耗 gas。调用前必须：(1) 用户明确确认 (2) 已经完成 simulation (3) 用户理解后果。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "signed_tx": {
        "type": "string",
        "description": "已签名的原始交易数据（0x 开头 RLP 编码+签名）"
      },
      "require_simulation_pass": {
        "type": "boolean",
        "description": "是否要求 simulation 通过才能发送。强烈建议 true。默认 true。",
        "default": true
      },
      "require_user_confirmation": {
        "type": "boolean",
        "description": "是否要求用户明确确认。默认 true。",
        "default": true
      },
      "simulation_context": {
        "type": "object",
        "description": "之前 alchemy_simulate 的结果。如果 require_simulation_pass=true，必须提供且 status 必须为 success。"
      }
    },
    "required": ["signed_tx"],
    "examples": [
      {"signed_tx": "0x02f8ab...", "require_simulation_pass": true, "require_user_confirmation": true}
    ]
  }
}
```

### 安全门控（确定性规则，不走模型推断）

```
IF require_simulation_pass=true AND (simulation_context IS NULL OR simulation_context.status != "success")
  → 拒绝调用，返回 error: SIMULATION_REQUIRED

IF require_user_confirmation=true AND no_explicit_user_confirmation
  → 拒绝调用，返回 error: USER_CONFIRMATION_REQUIRED

IF 以上检查通过
  → 发送交易，返回 tx_hash
```

---

## 工具调用模式

### 模式1：分析已有交易（只读）
```
Input: tx_hash
Tools: eth_getTransactionByHash → eth_getTransactionReceipt (decode_events=true)
                           ↓
                   + eth_getCode(to) 确认目标类型
                           ↓
                  alchemy_simulate 预测执行结果
                           ↓
                  组装 Chain-aware Context
```

### 模式2：分析待签名交易（只读 + 模拟）
```
Input: tx calldata + from + to
Tools: eth_call 查询当前 allowance/balance
     + eth_getCode(to) 确认合约
     + alchemy_simulate 模拟执行
     + eth_estimateGas 估算 gas
                           ↓
                  组装 Chain-aware Context
                           ↓
                  生成风险摘要
```

### 模式3：执行交易（写入，需确认）
```
Input: signed_tx
Tools: alchemy_simulate → 检查 status=success
     → 用户确认
     → eth_sendRawTransaction
     → eth_getTransactionReceipt 确认上链
```

---

## 错误处理统一规范

所有工具返回统一错误格式：
```jsonc
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误描述",
    "details": {}                    // 可选的额外信息
  }
}
```

| 错误码 | 说明 | 建议处理 |
|--------|------|---------|
| INVALID_ADDRESS | 地址格式不合法 | 检查输入 |
| INVALID_DATA | calldata 格式错误 | 检查 ABI 编码 |
| NO_CODE | 目标地址无合约代码 | 确认地址正确 |
| RPC_ERROR | 节点不可用 | 重试或换节点 |
| CALL_FAILED | eth_call revert | 附带 revert reason |
| SIMULATION_REQUIRED | 发送交易前未模拟 | 先调用 alchemy_simulate |
| USER_CONFIRMATION_REQUIRED | 未获得用户确认 | 提示用户确认 |
| TIMEOUT | 查询超时 | 重试 |
| RATE_LIMITED | API 速率限制 | 等待后重试 |

---

## 状态：完成

## 设计复盘

### 做对了什么
- 9 个工具覆盖完整分析链路：查询 → 解码 → 模拟 → 发送
- 写入类工具（T9）有确定性安全门控，不依赖模型判断
- 统一错误格式，Agent 可以程序化处理错误
- raw + human 双格式返回，减少模型处理大数的负担
- 每个工具的 description 包含使用场景和注意事项

### 与已有设计的衔接
- T1-T8 的返回格式直接对应 Chain-aware Context 的各层
- T8 (alchemy_simulate) 的返回对应 simulation 层
- T9 的安全门控对应 approval-agent-context-spec 的确定性规则
- 工具 schema 可以直接注册到 MCP server 或 Function Calling

### 下一步
- 实现这些工具的 MCP server 版本（替代之前的手动查询）
- 实现工具调用的 orchestration（模式1/2/3 的流程自动化）
- 对接 tx-risk-prompt：工具返回 → 填入 Context → 生成风险摘要
