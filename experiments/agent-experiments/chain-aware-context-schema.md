# Chain-aware Context — 数据结构设计

## 设计目标

Agent 在回答任何链相关问题前，必须有一份结构化的链上上下文快照。
这份快照回答的核心问题是：**"此刻链上正在发生什么，哪些是可信的？"**

核心原则：
1. 链上实时数据是唯一可信来源
2. 失败即停止（无法获取 = 不建议/无法判断）
3. 所有数据来源必须可追溯
4. 区分"事实"和"推断"和"不可信声明"

---

## Context Schema

```jsonc
{
  "schema_version": "1.0.0",
  "generated_at": "ISO-8601 timestamp",
  "ttl_seconds": 30,              // 上下文有效期，过期需重新获取
  "chain": { ... },               // 链标识 + 当前状态
  "account": { ... },             // 用户账户状态
  "transaction": { ... },         // 当前正在分析的交易
  "contract_context": { ... },    // 相关合约信息
  "simulation": { ... },          // 模拟执行结果
  "external_signals": { ... },    // 链下辅助信号
  "untrusted_inputs": { ... },    // 标记为不可信的输入
  "meta": { ... }                 // 上下文元数据
}
```

---

## 第一层：链状态（必须实时查询）

```jsonc
"chain": {
  "chain_id": 1,                        // eth_chainId
  "network_name": "ethereum",
  "block_number": 19876543,              // eth_blockNumber — 数据时效性基准
  "block_timestamp": 1716000000,         // 当前块时间戳
  "gas_price_wei": "25000000000",        // 当前 gas price
  "is_syncing": false,                  // 节点是否在同步中
  "source": "real_time",                // 来源标记 — 所有字段必须能追溯来源
  "query_status": "ok",                 // ok | degraded | failed
  "failed_fields": []                   // 如果部分查询失败，列出失败的字段
}
```

### 失败处理
- `query_status=degraded`: 部分字段缺失，标记 `failed_fields`，其余字段仍可用但要提醒
- `query_status=failed`: 整个上下文不可用，**停止并告知用户无法获取链上数据**
- `block_number` 超过 30 秒未更新 → 标记 stale，依然可用但附加警告

---

## 第二层：用户账户状态（必须实时查询）

```jsonc
"account": {
  "address": "0xAB...CD",
  "nonce": 42,                          // 当前 nonce — 防止重放
  "balance_wei": "1000000000000000000",  // ETH 余额
  "balance_human": "1.0 ETH",
  "is_contract": false,                 // EOA or CA — 如果有 code 则是合约
  "token_balances": [
    {
      "token_contract": "0xA0b8...48",
      "symbol": "USDC",
      "decimals": 6,
      "balance_raw": "5000000000",
      "balance_human": "5000 USDC",
      "source": "real_time"
    }
  ],
  "allowances": [                       // 当前授权情况 — 安全分析必需
    {
      "token": "USDC",
      "spender": "0x1111...582",
      "spender_name": "1inch Aggregation Router",  // 如能识别
      "allowance_raw": "100000000",
      "allowance_human": "100 USDC",
      "is_unlimited": false,
      "source": "real_time"
    }
  ],
  "source": "real_time",
  "query_status": "ok",
  "failed_fields": []
}
```

### 设计要点
- `balance` 和 `allowance` 同时提供 raw 和 human 格式 — 防止 decimals 处理错误
- `allowances` 可选（如果查询失败标记 degraded）
- `token_balances` 非强制，但如果有必须包含

---

## 第三层：待分析交易（必须实时解析）

```jsonc
"transaction": {
  // === 基础字段（解析必得）===
  "hash": "0x...",
  "from": "0xAB...CD",
  "to": "0x1111...582",
  "value_wei": "0",
  "value_human": "0 ETH",
  "nonce": 43,
  "gas_limit": "200000",
  "gas_price_wei": "25000000000",
  "max_fee_per_gas": null,              // EIP-1559
  "max_priority_fee": null,

  // === 函数解码（核心）===
  "function_signature": "approve(address,uint256)",
  "function_selector": "0x095ea7b3",
  "function_name": "approve",
  "function_params": {
    "spender": "0x1111...582",
    "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "amount_human": "无限",
    "amount_is_max_uint256": true
  },

  // === Calldata 原始数据（用于无法解码时）===
  "calldata": "0x095ea7b3...",
  "calldata_length": 68,
  "decode_status": "success",           // success | partial | unknown
  "decode_notes": [],                   // 如果 partial 说明哪些参数没解码

  // === 多调用拆解 ===
  "is_batch": false,
  "inner_calls": null,                  // 如果 multicall，拆解子调用

  "source": "real_time",
  "parse_status": "ok"
}
```

### 关键设计决策
1. **function_params 同时存 raw + human** — 防止大数和 max_uint256 被误判
2. **amount_is_max_uint256 布尔标记** — 不用让模型自己判断
3. **decode_status** — unknown 时不可生成确定性结论
4. **is_batch + inner_calls** — 批量交易必须拆解分析

---

## 第四层：合约上下文（可缓存，失败降级）

```jsonc
"contract_context": {
  "target_address": "0x1111...582",
  "target_name": "1inch Aggregation Router",  // contract name / label
  "is_known_contract": true,             // 是否在已知合约库中
  "known_contract_source": "1inch-docs",  // 来源

  // === 合约身份 ===
  "contract_type": "router",             // router | token | bridge | dao | unknown
  "contract_standard": null,             // ERC-20 | ERC-721 | ERC-1155 | null
  "implementation_address": null,        // proxy 模式下的实现合约

  // === 验证状态 ===
  "is_verified": true,
  "verified_at": "2023-01-15",
  "verification_source": "Etherscan",

  // === 安全信号 ===
  "deployed_at_block": 16500000,
  "contract_age_days": 892,
  "audits": [
    {
      "auditor": "OpenZeppelin",
      "date": "2023-02-01",
      "report_url": "https://...",
      "findings": "low"
    }
  ],
  "blacklisted": false,
  "blacklist_sources": [],

  "source": "cache",
  "cache_age_seconds": 45,              // 缓存了多久
  "ttl_seconds": 900,                   // 这个数据的有效期
  "query_status": "ok"
}
```

### 降级规则
- `query_status=degraded`：部分字段缺失，可用的用，缺的标 unknown
- `contract_age_days=unknown` + `is_verified=false` → 风险等级自动升级
- `blacklisted=true` → 无需继续分析，直接 stop

---

## 第五层：模拟执行结果

```jsonc
"simulation": {
  "status": "success",                  // success | failed | skipped
  "provider": "alchemy-simulate",
  "simulated_at_block": 19876543,

  // === 执行结果 ===
  "gas_used": "52341",
  "gas_estimate_delta": "+5%",          // 和用户设定的 gas 对比
  "state_changes": [
    {
      "type": "token_transfer",
      "asset": "USDC",
      "amount": "-100 USDC",
      "from": "0xUSER...ADDR",
      "to": "0xSPENDER...ADDR"
    },
    {
      "type": "approval",
      "asset": "USDC",
      "spender": "0xSPENDER...ADDR",
      "old_allowance": "50 USDC",
      "new_allowance": "无限"
    }
  ],

  // === 事件日志解码 ===
  "events_decoded": [
    {
      "name": "Approval",
      "address": "0xA0b8...48",
      "params": {
        "owner": "0xUSER...ADDR",
        "spender": "0xSPENDER...ADDR",
        "value": "max_uint256"
      }
    }
  ],

  // === 警告 ===
  "warnings": [
    {
      "type": "unlimited_approval",
      "severity": "high",
      "message": "无限授权检测"
    }
  ],

  // === 错误（如果失败）===
  "error": null,
  "error_reason": null,
  "error_trace": null,

  "source": "real_time",
  "query_status": "ok"
}
```

### simulation 失败处理
- `status=failed` + 当前交易 → 不用停止，但必须提醒"交易将 revert"
- `status=skipped`（无 simulation 工具可用）→ 标记不确定性
- `gas_used` 超过 `gas_limit` 的 80% → 警告 gas 可能不足

---

## 第六层：外部辅助信号（可选，可缓存）

```jsonc
"external_signals": {
  // === 代币价格 ===
  "token_prices": [
    {
      "symbol": "USDC",
      "price_usd": "1.00",
      "source": "coingecko",
      "updated_at": "2024-05-23T00:30:00Z"
    }
  ],

  // === Gas 分析 ===
  "gas_analysis": {
    "estimated_cost_usd": "$3.50",
    "comparison_to_avg": "+15%",
    "warning": null
  },

  // === 相关文档（RAG 结果）===
  "project_docs": [
    {
      "title": "1inch Router Documentation",
      "url": "https://docs.1inch.io/...",
      "snippet": "The Aggregation Router executes swaps across multiple DEXes...",
      "relevance": "high"
    }
  ],

  // === 历史交互记录 ===
  "user_history_with_target": {
    "has_interacted_before": true,
    "first_interaction_at": "2024-01-15",
    "interaction_count": 12,
    "last_interaction_type": "swap"
  },

  "source": "cache",
  "query_status": "ok"              // 这层允许 degraded，不影响主流程
}
```

---

## 第七层：不可信输入（必须隔离）

```jsonc
"untrusted_inputs": {
  "dapp_page_text": {
    "value": "授权 USDC 以在 1inch 上交易",
    "source": "UNTRUSTED_EXTERNAL",
    "warning": "dApp 页面声明，可能被伪造，不得作为事实依据"
  },
  "dapp_url": {
    "value": "https://app.1inch.io",
    "source": "UNTRUSTED_EXTERNAL",
    "warning": "URL 可被钓鱼伪造，需比对官方域名"
  },
  "user_intent": {
    "value": "在 1inch 上把 USDC 换成 ETH",
    "source": "USER_CLAIM",
    "warning": "需与链上数据交叉验证，不可直接采信"
  },
  "third_party_claims": [],          // 社交媒体推荐、他人建议等
  "model_prior_knowledge": {
    "value": "1inch is a known DEX aggregator",
    "source": "MODEL_KNOWLEDGE",
    "warning": "模型先验知识可能过时，仅作辅助参考"
  }
}
```

### 关键规则
- **这层数据只能用于交叉验证，不能作为正面证据**
- 如果链上数据与 untrusted 输入矛盾 → 以链上数据为准
- 模型自己的"印象"也在这层

---

## 元数据

```jsonc
"meta": {
  "context_id": "uuid-xxxx",          // 每次生成唯一 ID
  "generation_duration_ms": 450,      // 生成耗时
  "sources_queried": ["alchemy", "etherscan", "coingecko", "local-rag"],
  "sources_succeeded": ["alchemy", "etherscan", "local-rag"],
  "sources_failed": ["coingecko"],
  "total_cache_hits": 3,
  "total_real_time_queries": 8,
  "warnings": [
    "coingecko query failed — token prices unavailable"
  ]
}
```

---

## Context 组装流程

```
Step 1: chain + account (必须实时)
  → 如果 chain 查询失败 → 停止，返回错误
  → 如果 account 部分失败 → degraded，继续但标记

Step 2: transaction 解析
  → decode_status=unknown → 标记不确定性，不生成确定性结论

Step 3: contract_context (可缓存)
  → 缓存未命中 → 实时查询 → 降级为 unknown

Step 4: simulation (如果可用)
  → 不可用 → skipped，不阻塞

Step 5: external_signals (可选)
  → 失败不阻塞，仅减少辅助信息

Step 6: untrusted_inputs 隔离
  → 从 dApp 页面/用户输入收集 → 标记来源 → 仅用于交叉验证

Step 7: 合并输出
  → Chain-aware Context (完整 JSON)
  → 附带 degraded/failed 状态说明
```

---

## 状态的完整性与降级矩阵

| 组件 | 完全可用 | 部分可用 (degraded) | 不可用 (failed) |
|------|---------|--------------------|-----------------|
| chain | 正常分析 | 分析 + stale 警告 | **停止** |
| account | 正常分析 | 分析 + 余额未知警告 | **停止** |
| transaction | 正常分析 | 分析 + decode 未知警告 | **停止** |
| contract_context | 全量辅助 | 部分字段 unknown | 全部 unknown → 风险升级 |
| simulation | gas/事件分析 | 仅 status，无 details | 标记不确定性 |
| external_signals | 丰富上下文 | 无价格/无文档 | 不影响主流程 |
| untrusted_inputs | 交叉验证 | N/A（可选） | N/A |

---

## 状态：完成

## 设计复盘

### 做对了什么
- 分层清晰：实时/缓存/不可信，三层隔离
- 可审计：每个字段有 source 和 query_status
- 降级可控：不同组件失败有不同的处理策略
- raw + human 双格式：防止大数/N 值被模型误判
- simulation 的结构化：不只是 pass/fail，还有事件解码

### 下一阶段
- 实现 Context Builder：给定 tx_hash + chain_id 自动生成这份 Context
- 对接 MCP Context Provider：将 Chain-aware Context 作为 MCP resource 暴露
- 对接 tx-risk-prompt：将 Context 注入 System Prompt 的 input 部分
