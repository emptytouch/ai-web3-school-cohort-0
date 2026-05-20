# 钱包授权检查 Agent — Context Spec

## 场景
用户问："这个 dApp 要我 approve，可以签吗？"

## 目标
模型在回答前，必须拿到足够的上下文来判断这笔 approve 是否安全。
模型不能仅凭 dApp 页面的话就给出建议。

---

## 上下文字段清单

### 第一层：必须实时查询（不可缓存，不可推断）

| 字段 | 来源 | 原因 |
|------|------|------|
| chain_id | RPC `eth_chainId` | 防止跨链重放攻击，确认用户在正确的链上 |
| current_block | RPC `eth_blockNumber` | 判断数据时效性，防止基于过期数据的决策 |
| token_contract | RPC `eth_call` 读合约 `name()` / `symbol()` / `decimals()` | 确认代币身份，防止假币 |
| spender_address | 解析交易 calldata | 谁将获得授权，核心风险点 |
| approve_amount | 解析交易 calldata | 授权数量，判断是否无限授权 |
| user_current_allowance | RPC `eth_call` 读合约 `allowance(owner, spender)` | 当前已授权额度，判断是否叠加授权 |
| user_token_balance | RPC `eth_call` 读合约 `balanceOf(user)` | 用户余额，判断授权是否超过持有量 |
| simulation_result | 交易模拟（Tenderly / Alchemy simulate） | 预测执行结果，发现隐藏副作用 |

### 第二层：可缓存（TTL 5-15 分钟）

| 字段 | 来源 | TTL | 原因 |
|------|------|-----|------|
| spender_trust_status | 可信合约数据库（如 revoke.cash / Forta） | 15 min | spender 是否已知/审计/列入黑名单 |
| token_metadata | CoinGecko / 本地代币列表 | 5 min | 代币名称、符号、价格（用于展示风险金额） |
| spender_contract_verified | Etherscan API | 15 min | 合约是否已验证，未验证 = 高风险信号 |
| spender_contract_age | Etherscan API | 15 min | 合约部署时间，新合约风险更高 |

### 第三层：来自用户输入（标记为不可信，需交叉验证）

| 字段 | 来源 | 处理方式 |
|------|------|---------|
| dapp_page_description | dApp 页面文本/说明 | 标记为 `[UNTRUSTED_EXTERNAL]`，仅作参考，不作为事实依据 |
| dapp_url | 浏览器地址栏 | 用于比对官方域名，但可被钓鱼伪造 |
| user_intent | 用户口述/输入 | 标记为 `[USER_CLAIM]`，需与交易数据交叉验证 |

### 第四层：绝对不能当成事实（只能作为辅助信号）

| 字段 | 原因 |
|------|------|
| dApp 页面上的"安全"声明 | 攻击者可以在页面上写任何话 |
| 模型自己对该 dApp 的"印象" | 模型可能记错或被 prompt injection 影响 |
| 社交媒体上的推荐 | 可能是付费推广或过时信息 |
| 其他用户的评价 | 无法验证真实性 |

---

## Context 组装顺序

```
Step 1: 实时查询（第一层）
  → 获取链上真实数据
  → 如果任何查询失败，停止并告知用户"无法获取链上数据，不建议签名"

Step 2: 缓存查询（第二层）
  → 获取 spender 信誉信息
  → 如果缓存未命中，标记为"未知"，不阻塞流程

Step 3: 用户输入处理（第三层）
  → 将 dApp 说明标记为 [UNTRUSTED_EXTERNAL]
  → 将用户意图标记为 [USER_CLAIM]
  → 与第一层数据交叉验证

Step 4: 生成分析
  → 仅基于第一层（事实）+ 第二层（辅助）生成判断
  → 第三层仅用于交叉验证，不作为正面证据
```

---

## 风险判定规则（确定性，不走模型推断）

| 条件 | 风险等级 | 动作 |
|------|---------|------|
| approve_amount == max_uint255 | high | 标记"无限授权"，建议改为精确金额 |
| spender 未验证 | high | 标记"合约未验证"，建议停止 |
| spender 在黑名单 | critical | 标记"已知恶意合约"，强烈建议停止 |
| dApp URL 与官方域名不匹配 | critical | 标记"可能的钓鱼网站"，强烈建议停止 |
| approve_amount > user_balance | medium | 标记"授权超过持有量"，提示确认 |
| 用户已有非零 allowance + 新授权 | medium | 标记"授权叠加"，提示确认是否有意为之 |
| spender 合约年龄 < 7 天 | medium | 标记"新部署合约"，提示额外谨慎 |

---

## 模型输出格式

```json
{
  "verdict": "safe | caution | dangerous | stop",
  "summary": "一句话总结这笔 approve 的风险",
  "risk_factors": ["具体风险点"],
  "context_used": {
    "real_time": ["实际查询到的字段"],
    "cached": ["缓存命中的字段"],
    "untrusted": ["标记为不可信的输入"]
  },
  "missing_context": ["未能获取的字段及影响"],
  "recommendation": "给用户的具体建议",
  "requires_human_approval": true|false
}
```

---

## 示例 Context 实例

```json
{
  "chain_id": "1",
  "current_block": 19876543,
  "token_contract": {
    "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "name": "USD Coin",
    "symbol": "USDC",
    "decimals": 6,
    "source": "real_time"
  },
  "spender_address": "0x1111111254eeb25477b68fb85ed929f73a960582",
  "approve_amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  "approve_amount_human": "无限",
  "user_current_allowance": "0",
  "user_token_balance": "5000000000",
  "user_token_balance_human": "5000 USDC",
  "simulation_result": {
    "status": "success",
    "gas": "52000",
    "warnings": ["unlimited approval"]
  },
  "spender_trust_status": {
    "verified": true,
    "name": "1inch Aggregation Router",
    "age_days": 892,
    "blacklisted": false,
    "source": "cache"
  },
  "dapp_page_description": {
    "value": "授权 USDC 以在 1inch 上交易",
    "source": "UNTRUSTED_EXTERNAL"
  },
  "user_intent": {
    "value": "在 1inch 上把 USDC 换成 ETH",
    "source": "USER_CLAIM"
  }
}

## 实验结论

1. 链上实时数据是唯一可信来源
2. 失败即停止（无法获取 = 不建议签名）
3. 确定性规则兜底，不依赖模型推断
4. 不可信标记防止 prompt injection
5. context_used 字段保证可审计
```
