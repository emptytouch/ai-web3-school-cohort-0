#!/usr/bin/env node
/**
 * 离线测试 - 用 mock 数据验证 LLM 解释生成
 * 用法: node test-offline.js
 */

import "dotenv/config";
import { generateExplanation } from "./src/llm-explainer.js";

// Mock 数据: 模拟一笔 Uniswap V2 ETH -> USDC swap
const mockTxData = {
  txHash:
    "0x8f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
  status: "success",
  blockNumber: 18000000,
  from: "0x1234567890abcdef1234567890abcdef12345678",
  to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  valueEth: 1.5,
  gasUsed: 150000,
  gasPriceGwei: 25.5,
  gasFeeEth: 0.003825,
  nonce: 42,
  input: {
    type: "contractCall",
    function: "swapExactETHForTokens(uint256,address[],address,uint256)",
    selector: "0x7ff36ab5",
    calldata:
      "00000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000000800000000000000000000000001234567890abcdef1234567890abcdef123456780000000000000000000000000000000000000000000000000000000065a1b2c3",
    decodedParams: [
      "1000000",
      "0x...",
      "0x1234567890abcdef1234567890abcdef12345678",
      "1705000000",
    ],
  },
  logsCount: 4,
  logs: [
    {
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      event: "Transfer(address,address,uint256)",
      eventSignature:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000001234567890abcdef1234567890abcdef12345678",
        "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
        "0x00000000000000000000000000000000000000000000000014d1120d7b160000",
      ],
      data: "0x",
      knownAddress: "WETH",
      from: "0x1234567890abcdef1234567890abcdef12345678",
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      value: "1500000000000000000",
    },
    {
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      event: "Transfer(address,address,uint256)",
      eventSignature:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
        "0x0000000000000000000000001234567890abcdef1234567890abcdef12345678",
        "0x00000000000000000000000000000000000000000000000000000000001e8480",
      ],
      data: "0x",
      knownAddress: "USDC",
      from: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "2000000",
    },
  ],
  contractName: "UniswapV2Router02",
  contractABIAvailable: true,
  involvedProtocols: ["Uniswap V2 Router", "WETH", "USDC"],
  involvedAddresses: [
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  ],
  assets: [
    {
      token: "WETH",
      tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      amountRaw: "1500000000000000000",
      from: "0x1234567890abcdef1234567890abcdef12345678",
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
    },
    {
      token: "USDC",
      tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      amountRaw: "2000000",
      from: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      to: "0x1234567890abcdef1234567890abcdef12345678",
    },
  ],
};

async function main() {
  console.log("🧪 离线测试: 模拟 Uniswap ETH -> USDC swap\n");

  const explanation = await generateExplanation(mockTxData);

  if (explanation.error) {
    console.log(`⚠️  LLM 错误: ${explanation.error}`);
    console.log("\n--- Fallback 输出 ---");
    console.log(JSON.stringify(explanation.fallback, null, 2));
  } else {
    console.log("✅ LLM 解释生成成功:\n");
    console.log(JSON.stringify(explanation, null, 2));
  }
}

main().catch(console.error);
