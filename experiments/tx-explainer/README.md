# Transaction Explainer

输入一笔以太坊交易哈希，自动读取链上数据、解码事件日志，并由 LLM 生成结构化解释。

## 输出内容

1. **用户发起了什么动作** — swap/transfer/approve/bridge 等
2. **涉及哪些资产和地址** — token、金额、from/to
3. **哪些信息来自链上数据，哪些是模型推断** — 明确标注来源
4. **模型不确定的地方** — 诚实标注不确定性
5. **如果要签类似交易，用户应该检查什么** — 安全提示

## 快速开始

```bash
cd hackathon/tx-explainer
npm install
cp .env.example .env
# 编辑 .env 填入 RPC_URL 和 OPENROUTER_API_KEY
node explain.js 0x<tx_hash>
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `RPC_URL` | Ethereum JSON-RPC 端点 | `https://eth-mainnet.g.alchemy.com/v2/xxx` |
| `ETHERSCAN_API_KEY` | Etherscan API Key (可选，用于获取 ABI) | `XXXXXXXX` |
| `OPENROUTER_API_KEY` | OpenRouter API Key | `sk-or-xxx` |
| `LLM_MODEL` | 模型名称 | `openrouter/anthropic/claude-sonnet-4` |

## 命令

```bash
# 解释一笔交易
node explain.js 0x<tx_hash>

# 输出原始 JSON
node explain.js 0x<tx_hash> --json

# 离线测试 (不需要 RPC)
node test-offline.js
```

## 项目结构

```
tx-explainer/
├── explain.js           # CLI 入口
├── src/
│   ├── chain-data.js    # 链上数据获取 + 解码
│   └── llm-explainer.js # LLM 解释生成
├── test-offline.js      # 离线测试
├── package.json
└── .env.example
```
