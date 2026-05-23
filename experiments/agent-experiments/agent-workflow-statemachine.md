# Agent Workflow — 状态机设计

## 设计目标

为交易解释器 Agent 设计一个清晰的状态机，覆盖从"用户输入交易哈希"到"输出风险摘要/执行交易"的完整流程。

设计原则：
1. **每个状态有明确的进入条件、执行动作、退出条件**
2. **失败可以降级，但不能静默跳过**
3. **高风险状态必须有人工检查点（human checkpoint）**
4. **状态可追溯：每次转移都记录原因**

---

## 状态概览

```
                    ┌──────────────────────────────────────────────────────┐
                    │                                                      │
                    ▼                                                      │
              ┌──────────┐     ┌──────────┐     ┌──────────┐              │
              │ S1_INPUT │────▶│ S2_FETCH │────▶│ S3_PARSE │              │
              └──────────┘     └──────────┘     └──────────┘              │
                                        │                │                 │
                                        │ failed         │ unknown func    │
                                        ▼                ▼                 │
                                   ┌──────────┐   ┌──────────┐           │
                                   │ S2_RETRY │   │ S3_DEGRADE│           │
                                   └──────────┘   └──────────┘           │
                                        │                │                 │
                                        └────────────────┘                 │
                                                   │                       │
                                                   ▼                       │
              ┌──────────┐     ┌──────────┐     ┌──────────┐              │
              │ S7_OUTPUT │◀────│ S6_CHECK │◀────│ S5_SIM   │              │
              └──────────┘     └──────────┘     └──────────┘              │
                    │                │                │                    │
                    │                │ risk high      │ sim failed         │
                    │                ▼                ▼                    │
                    │          ┌──────────┐     ┌──────────┐              │
                    │          │ S6_HUMAN │     │ S5_DEGRADE│              │
                    │          └──────────┘     └──────────┘              │
                    │                │                                     │
                    │                │ user approves                       │
                    │                ▼                                     │
                    │          ┌──────────┐     ┌──────────┐              │
                    └─────────▶│ S8_EXEC  │────▶│ S9_CONFIRM│              │
                               └──────────┘     └──────────┘              │
                                    │                                     │
                                    │ user declines / risk critical        │
                                    ▼                                     │
                               ┌──────────┐                               │
                               │ S0_ABORT │                               │
                               └──────────┘                               │
```

---

## 状态详细定义

### S0_ABORT — 中止

| 属性 | 值 |
|------|------|
| **类型** | 终止状态 |
| **触发条件** | 任何关键步骤不可恢复失败；用户取消；风险等级=critical 且用户未确认 |
| **执行动作** | 输出中止原因 + 已收集到的上下文摘要 |
| **输出** | `reason` + partial context + 建议 |

---

### S1_INPUT — 输入解析

| 属性 | 值 |
|------|------|
| **类型** | 开始状态 |
| **进入条件** | 用户输入 tx_hash / calldata / 自然语言描述 |
| **执行动作** | 1. 识别输入类型（tx_hash / calldata / 用户意图描述）2. 规范化 (tx_hash 补全 0x 前缀等) 3. 提取 user_intent |
| **退出条件** | 输入有效 → S2；输入无效 → S0_ABORT |
| **可失败** | 否（输入无效直接中止）|
| **人工检查点** | 否 |

```
Input Types:
  - tx_hash:     0x + 64 hex → S2_FETCH
  - calldata:    {from, to, data, value} → S3_PARSE (skip fetch)
  - user_intent: "我想在 Uniswap 上换 ETH" → 需要先构造交易草稿 → S3_PARSE
  - invalid:     → S0_ABORT (提示输入格式不正确)
```

---

### S2_FETCH — 获取链上数据

| 属性 | 值 |
|------|------|
| **类型** | 工具调用 |
| **进入条件** | S1 输出了有效 tx_hash 或地址 |
| **执行动作** | 并行调用: `eth_getTransactionByHash` + `eth_blockNumber` + `eth_getCode(to)` + `eth_getBalance(from)` |
| **退出条件** | 核心数据获取成功 → S3；部分失败 → S2_RETRY；完全失败 → 3 次重试后 S0_ABORT |
| **可失败** | 是 → S2_RETRY（最多 2 次，换 RPC 节点）|
| **人工检查点** | 否 |

```
Parallel Calls:
  ├── eth_getTransactionByHash(tx_hash)     → tx_data
  ├── eth_blockNumber()                      → current_block
  ├── eth_getCode(tx.to)                     → is_contract
  ├── eth_getBalance(tx.from)               → sender_balance
  └── eth_call(tx.to, tokenOf()/name())      → token_info (optional)

Failure Handling:
  - tx_data null (tx not found) → S0_ABORT ("交易不存在或还未上链")
  - block number failed → mark stale, continue with degraded
  - balance failed → mark unknown, continue
```

---

### S3_PARSE — 交易解析与解码

| 属性 | 值 |
|------|------|
| **类型** | 分析 |
| **进入条件** | S2 返回了 tx 数据 |
| **执行动作** | 1. Decode function signature (4-byte selector lookup) 2. Decode parameters (ABI) 3. Extract: function_name, params, value, target_type 4. Compute derived fields (amount_is_max_uint256, etc.) |
| **出口** | decode success → S4；decode partial → S3_DEGRADE；decode unknown → S3_DEGRADE |
| **可失败** | 是 → S3_DEGRADE |

```
Decode Pipeline:
  1. selector = calldata[0:4]
  2. lookup selector in known signatures DB → function_name + param_types
  3. ABI decode params
  4. computed_fields:
     - amount_is_max_uint256
     - amount_human (apply decimals)
     - is_batch (multicall)
     - inner_calls (if batch)

States:
  - FULL:   所有参数解码成功 → S4_RETRIEVE
  - PARTIAL: selector 识别但部分参数未解码 → S3_DEGRADE → S4_RETRIEVE
  - UNKNOWN: selector 不在 DB → S3_DEGRADE → S4_RETRIEVE
```

---

### S3_DEGRADE — 解析降级

| 属性 | 值 |
|------|------|
| **类型** | 降级状态 |
| **进入条件** | S3 解码失败或部分失败 |
| **执行动作** | 标记 decode_status=unknown/partial → 在后续分析中降低确定性等级 → 在 uncertainties 中加入"无法完全解码交易数据" |
| **退出条件** | 无条件 → S4 |
| **人工检查点** | 否 |

---

### S4_RETRIEVE — RAG 检索

| 属性 | 值 |
|------|------|
| **类型** | 工具调用 |
| **进入条件** | S3/S3_DEGRADE 完成 |
| **执行动作** | 1. Contract lookup: 目标合约的文档/审计报告 2. Token lookup: 代币信息 3. Project lookup: 项目背景（如"1inch"、"Uniswap"）4. Security lookup: 已知攻击模式匹配 |
| **出口** | success → S5；部分/全部失败 → S5（降级，不阻塞）|
| **可失败** | 是（不阻塞，仅减少上下文）|
| **人工检查点** | 否 |

```
RAG Queries (按优先级):
  1. contract_address → contract_docs (whitepaper, audit reports)
  2. contract_address → known_contract_db (trust status)
  3. token_address → token_metadata (name, symbol, official site)
  4. (function_name, contract_type) → attack_patterns (known exploits)

Result: external_signals layer of Chain-aware Context
Note: Failure = missing context, NOT blocking
```

---

### S5_SIM — 模拟执行

| 属性 | 值 |
|------|------|
| **类型** | 工具调用 |
| **进入条件** | S4 完成（或 S3_DEGRADE 跳过 S4）|
| **执行动作** | 1. 调用 alchemy_simulate (include_events=true) 2. 如果 alchemy 不可用，降级到 eth_estimateGas 3. 解析 asset_changes + events + warnings |
| **出口** | sim=success → S6；sim=failed → S5_DEGRADE；sim=unavailable → S5_DEGRADE |
| **可失败** | 是 → S5_DEGRADE |
| **人工检查点** | 否 |

```
Simulation Calls (优先级):
  1. alchemy_simulate(from, to, data, value, include_events=true)
  2. Fallback: eth_estimateGas(from, to, data, value)
  3. Skip: mark simulation=skipped

Post-sim checks:
  - status=FAILED → add warning "交易将 revert"
  - gas_used > 80% of gas_limit → add warning "gas 余量不足"
  - events include unexpected Transfer → add warning "检测到非预期的资产转移"
```

---

### S5_DEGRADE — 模拟降级

| 属性 | 值 |
|------|------|
| **类型** | 降级状态 |
| **进入条件** | S5 模拟失败或不可用 |
| **执行动作** | 标记 simulation=skipped/failed → 在 uncertainties 中加入"无法模拟交易执行结果" |
| **退出条件** | 无条件 → S6 |
| **人工检查点** | 否 |

---

### S6_CHECK — 风险检查

| 属性 | 值 |
|------|------|
| **类型** | 分析（确定性规则 + LLM）|
| **进入条件** | S5/S5_DEGRADE 完成 |
| **执行动作** | **Phase A: 确定性规则**（优先执行，不走模型）: 逐条匹配 risk_rules.md 中的规则 → 输出 risk_factors[] + deterministic_risk_level。**Phase B: LLM 综合分析**: 将 Chain-aware Context + risk_factors 输入 LLM → 生成 uncertainties + recommended_user_checks + final_risk_level。**Phase C: 冲突解决**: 如果 deterministic 和 LLM 的 risk_level 不一致 → 取较高者。 |
| **出口** | risk ≤ medium → S7；risk ≥ high → S6_HUMAN |
| **可失败** | 否（规则总是可执行）|
| **人工检查点** | 间接（高风险转 S6_HUMAN）|

```
Phase A: Deterministic Rules
  IF amount_is_max_uint256         → risk_factors += unlimited_approval
  IF spender blacklisted           → risk_factors += blacklisted
  IF decode_status=unknown         → risk_factors += unreadable_calldata
  IF sim.status=failed             → risk_factors += will_revert
  IF url_mismatch                  → risk_factors += possible_phishing
  ... (匹配 approval-agent-context-spec 的 7 条规则)
  → deterministic_risk_level = max(matched levels)

Phase B: LLM Analysis (if needed)
  Input: Chain-aware Context + risk_factors + rule_matches
  Output: uncertainties[], recommended_user_checks[], llm_risk_level

Phase C: Resolution
  final_risk_level = max(deterministic_risk_level, llm_risk_level)
```

---

### S6_HUMAN — 人工检查点

| 属性 | 值 |
|------|------|
| **类型** | 人工检查点 |
| **进入条件** | S6 risk_level ≥ high |
| **执行动作** | 1. 输出风险摘要 + 已识别的 risk_factors 2. 询问用户是否继续 3. 等待用户确认或拒绝 |
| **出口** | user_approves → S7；user_declines → S0_ABORT；timeout → S0_ABORT |
| **可失败** | 否（用户无响应 = 中止）|
| **人工检查点** | ✅ 是 |

```
Output to user:
  ⚠️ 高风险交易检测
  
  risk_level: high/critical
  summary: "这是一笔无限授权交易..."
  risk_factors:
    - 无限授权给未验证合约
    - 合约部署不到 7 天
  recommended_checks:
    - 确认目标合约是你要交互的项目
    - ...
  
  → 是否继续？ [确认 / 取消]
```

---

### S7_OUTPUT — 生成输出

| 属性 | 值 |
|------|------|
| **类型** | 输出状态 |
| **进入条件** | S6 risk_level ≤ medium（直接通过）或 S6_HUMAN user_approves |
| **执行动作** | 1. 组装最终 JSON 输出（按 tx-risk-prompt schema）2. 标注每项信息的来源（chain/untrusted/model inference）3. 标注 uncertainties |
| **出口** | 用户要求执行 → S8；否则 → 结束 |
| **人工检查点** | 否 |

```
Output Schema (reference tx-risk-prompt/SYSTEM_PROMPT.md):
{
  "summary": "...",
  "asset_changes": [...],
  "permissions_changed": [...],
  "risk_level": "low|medium|high|critical",
  "requires_human_approval": true|false,
  "uncertainties": [...],
  "recommended_user_checks": [...],
  "context_used": { "real_time": [...], "cached": [...], "untrusted": [...] },
  "workflow_trace": ["S1→S2→S3→S4→S5→S6→S7"]  // 可追溯
}
```

---

### S8_EXEC — 执行交易

| 属性 | 值 |
|------|------|
| **类型** | 写入操作 |
| **进入条件** | 用户明确要求执行 + S7 已完成分析 |
| **执行动作** | 1. 检查 safety_gates: simulation_passed AND user_confirmed 2. 发送 eth_sendRawTransaction 3. 等待上链确认 |
| **出口** | tx sent → S9；safety_gate failed → S0_ABORT；send failed → S0_ABORT |
| **可失败** | 是 → S0_ABORT |
| **人工检查点** | ✅ 是（双重确认：S6_HUMAN + S8 的 user_confirmed）|

```
Safety Gates (ALL must pass):
  ✅ simulation_context.status == "success" (or simulation=skipped marked in uncertainties)
  ✅ user explicitly confirmed (not expired, not default)
  ✅ require_simulation_pass AND require_user_confirmation (from T9 schema)

Post-send:
  - return tx_hash
  - wait for receipt (optional, user-configurable)
```

---

### S9_CONFIRM — 确认上链

| 属性 | 值 |
|------|------|
| **类型** | 终态 |
| **进入条件** | S8 发送成功 |
| **执行动作** | 1. 轮询 eth_getTransactionReceipt 2. 确认 status=success 3. 输出最终状态（成功/失败 + 实际 gas 消耗）|
| **出口** | 成功 → 结束；失败 → 输出 revert reason |
| **人工检查点** | 否 |

---

## 状态转移完整表

| From | To | Condition | Requires Human |
|------|-----|-----------|---------------|
| S1_INPUT | S2_FETCH | input_valid=true | No |
| S1_INPUT | S0_ABORT | input_invalid | No |
| S2_FETCH | S3_PARSE | core_data_ok | No |
| S2_FETCH | S2_RETRY | partial_fail, retries<2 | No |
| S2_RETRY | S2_FETCH | retry | No |
| S2_RETRY | S0_ABORT | retries exhausted | No |
| S3_PARSE | S4_RETRIEVE | decode=full | No |
| S3_PARSE | S3_DEGRADE | decode=partial/unknown | No |
| S3_DEGRADE | S4_RETRIEVE | unconditional | No |
| S4_RETRIEVE | S5_SIM | unconditional (failure is degraded) | No |
| S5_SIM | S6_CHECK | sim=success | No |
| S5_SIM | S5_DEGRADE | sim=failed/unavailable | No |
| S5_DEGRADE | S6_CHECK | unconditional | No |
| S6_CHECK | S7_OUTPUT | risk≤medium | No |
| S6_CHECK | S6_HUMAN | risk≥high | ✅ Yes |
| S6_HUMAN | S7_OUTPUT | user_approves | ✅ Yes |
| S6_HUMAN | S0_ABORT | user_declines/timeout | ✅ Yes |
| S7_OUTPUT | S8_EXEC | user_requests_execution | ✅ Yes |
| S7_OUTPUT | END | display only | No |
| S8_EXEC | S9_CONFIRM | safety_gates_pass | ✅ Yes |
| S8_EXEC | S0_ABORT | safety_gate_fail | No |
| S9_CONFIRM | END | receipt received | No |

---

## 降级路径汇总

```
Full Path:    S1 → S2 → S3 → S4 → S5 → S6 → S7 → (S8 → S9)
                    ↓         ↓         ↓
Degraded:     S1 → S2 → S3_DEGRADE → S4(degraded) → S5_DEGRADE → S6 → S7

Worst Case:   S1 → S2 → S3_DEGRADE → S4(no RAG) → S5_DEGRADE → S6(rules only) → S7(uncertainties=high)
              → S6_HUMAN → (user decides)

Abort Paths:  S1 → S0_ABORT (bad input)
              S2 → S2_RETRY → S0_ABORT (RPC down)
              S6_HUMAN → S0_ABORT (user declines)
              S8 → S0_ABORT (safety gate)
```

---

## Observability

每次状态转移都记录：

```jsonc
{
  "timestamp": "...",
  "from": "S5_SIM",
  "to": "S6_CHECK",
  "reason": "simulation_success",
  "duration_ms": 450,
  "data": {
    "gas_used": "156432",
    "sim_status": "success"
  }
}
```

workflow_trace 字段在最终输出中呈现，让用户可以看到 Agent 走了什么路径：

```
workflow_trace: [
  "S1_INPUT (tx_hash validated)",
  "S2_FETCH (eth_getTransactionByHash + eth_getCode + eth_getBalance)",
  "S3_PARSE (decode=full, function=approve)",
  "S4_RETRIEVE (contract=1inch, docs found, 2 cache hits)",
  "S5_SIM (success, gas=185000, 2 events decoded)",
  "S6_CHECK (deterministic: high [unlimited_approval], LLM: high)",
  "S6_HUMAN → user approved with caution",
  "S7_OUTPUT"
]
```

---

## 状态：完成

## 设计复盘

### 做对了什么
- 完整覆盖：从输入到执行到确认的全链路
- 降级路径清晰：每个步骤都有 degraded 版本，确保最差也能给出有不确定性的分析
- 高风险有硬检查点：S6_HUMAN + S8_EXEC 双重确认，不可绕过
- 确定性规则优先：S6_CHECK 的 Phase A 先走规则，LLM 只做补充，防止模型遗漏
- 可追溯：workflow_trace 让每次决策路径可审计

### 与已有设计的衔接
- S2/S3 对应 Chain-aware Context 的第一层和第三层组装
- S4 对应 external_signals 层的 RAG 检索
- S5 对应 simulation 层
- S6 对应 tx-risk-prompt 的 System Prompt + 确定性规则
- S8/S9 对应 web3-tool-use 的 T9 (eth_sendRawTransaction)

### 下一步
- 将这个 state machine 实现为 Python state machine（transitions 库或手写）
- 对接 MCP server 的工具作为各状态的工具调用后端
- 添加 timeout 处理和用户交互接口
