# 测试用例 1：普通转账（低风险）

## 场景
用户想给朋友转 100 USDC。

## 输入

```json
{
  "tx_target": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "function_name": "transfer",
  "parameters": {
    "to": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    "value": "100000000"
  },
  "asset_changes": [
    {
      "direction": "out",
      "asset": "USDC",
      "amount": "100 USDC",
      "to_from": "0x7a25...488D"
    }
  ],
  "simulation_result": {
    "status": "success",
    "gas_estimated": "45000",
    "warnings": []
  },
  "user_intent": "给朋友转 100 USDC"
}
```

## 预期输出要点

- risk_level: low
- requires_human_approval: false
- permissions_changed: []
- 无 uncertainties
