# 测试用例 2：无限授权（高风险）

## 场景
用户想在一个 DEX 上交易，但 DEX 要求先 approve 无限 USDC。

## 输入

```json
{
  "tx_target": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "function_name": "approve",
  "parameters": {
    "spender": "0x1111111254eeb25477b68fb85ed929f73a960582",
    "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  },
  "asset_changes": [],
  "simulation_result": {
    "status": "success",
    "gas_estimated": "52000",
    "warnings": [
      "approve amount is max uint255 (unlimited)"
    ]
  },
  "user_intent": "在 DEX 上交易 USDC"
}
```

## 预期输出要点

- risk_level: high
- requires_human_approval: true
- permissions_changed: ["授予 0x1111...0582 无限 USDC 授权"]
- uncertainties: ["用户是否知晓这是无限授权而非单次授权"]
- recommended_user_checks: 应包含"确认是否需要无限授权"、"检查 spender 地址是否为官方 DEX 合约"
