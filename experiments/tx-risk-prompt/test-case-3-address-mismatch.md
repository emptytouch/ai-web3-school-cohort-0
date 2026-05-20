# 测试用例 3：目标地址与用户意图不匹配（严重风险）

## 场景
用户说"我想质押 ETH 到 Lido"，但交易目标是一个未知合约地址，函数是 approve + transferFrom 组合，资产变化显示 ETH 被转到未知地址。

## 输入

```json
{
  "tx_target": "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
  "function_name": "approveAndCall",
  "parameters": {
    "spender": "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
    "amount": "1000000000000000000",
    "data": "0xdeadbeef"
  },
  "asset_changes": [
    {
      "direction": "out",
      "asset": "ETH",
      "amount": "1 ETH",
      "to_from": "0xDeaD...beef"
    }
  ],
  "simulation_result": {
    "status": "success",
    "gas_estimated": "180000",
    "warnings": [
      "target contract is not verified on Etherscan",
      "function signature is non-standard"
    ]
  },
  "user_intent": "我想质押 ETH 到 Lido"
}
```

## 预期输出要点

- risk_level: critical
- requires_human_approval: true
- permissions_changed: ["授予 0xDeaD...beef 1 ETH 操作权限"]
- uncertainties: 必须包含"目标地址与 Lido 官方合约不符"、"合约未验证"
- recommended_user_checks: 必须包含"目标地址不是 Lido 官方合约"、"立即停止签名"
