#!/usr/bin/env node
/**
 * 交易解释器 CLI
 * 用法: node explain.js <tx_hash> [--json]
 */

import "dotenv/config";
import { fetchTransactionData } from "./src/chain-data.js";
import { generateExplanation } from "./src/llm-explainer.js";

const SEP = "═".repeat(60);
const SUBSEP = "─".repeat(60);

function formatOutput(txData, explanation) {
  const lines = [];

  lines.push(`\n${SEP}`);
  lines.push("  交易解释器 | Transaction Explainer");
  lines.push(SEP);
  lines.push(`  哈希: ${txData.txHash}`);
  lines.push(`  状态: ${txData.status === "success" ? "✅ 成功" : "❌ 失败"}`);
  lines.push(`  区块: ${txData.blockNumber.toLocaleString()}`);
  lines.push(`${SEP}\n`);

  // 如果有错误但有 fallback
  if (explanation.error && !explanation.fallback) {
    lines.push(`⚠️  LLM 错误: ${explanation.error}\n`);
    return lines.join("\n");
  }

  const data = explanation.fallback || explanation;

  // 1. 概要
  lines.push("📋 概要");
  lines.push(SUBSEP);
  lines.push(`  ${data.summary || "N/A"}\n`);

  // 2. 用户动作
  const action = data.action || {};
  lines.push("🎯 用户动作");
  lines.push(SUBSEP);
  const typeEmoji = {
    swap: "🔄",
    transfer: "📤",
    approve: "✅",
    bridge: "🌉",
    contractCall: "📞",
    unknown: "❓",
  };
  const emoji = typeEmoji[action.type] || "❓";
  lines.push(`  ${emoji} 类型: ${action.type || "unknown"}`);
  lines.push(`  📝 描述: ${action.description || "N/A"}`);
  if (action.protocol && action.protocol !== "unknown")
    lines.push(`  🏗️  协议: ${action.protocol}`);
  if (action.functionCalled && action.functionCalled !== "N/A")
    lines.push(`  🔧 函数: ${action.functionCalled}`);
  lines.push("");

  // 3. 资产
  if (data.assets && data.assets.length > 0) {
    lines.push("💰 涉及资产");
    lines.push(SUBSEP);
    for (const asset of data.assets) {
      const dirEmoji =
        asset.direction === "in"
          ? "📥"
          : asset.direction === "out"
            ? "📤"
            : "•";
      lines.push(
        `  ${dirEmoji} ${asset.token || "unknown"}: ${asset.amount || "N/A"}`
      );
      if (asset.address)
        lines.push(
          `     合约: ${asset.address.slice(0, 10)}...${asset.address.slice(-8)}`
        );
    }
    lines.push("");
  }

  // 4. 地址
  if (data.addresses && data.addresses.length > 0) {
    lines.push("📍 涉及地址");
    lines.push(SUBSEP);
    for (const addr of data.addresses) {
      const v = addr.verified ? "✅" : "❓";
      lines.push(
        `  ${v} [${addr.role || "unknown"}] ${addr.name || "unknown"}`
      );
      lines.push(`     ${addr.address || "N/A"}`);
    }
    lines.push("");
  }

  // 5. 数据来源
  if (data.dataSources && data.dataSources.length > 0) {
    lines.push("📊 信息来源");
    lines.push(SUBSEP);
    for (const ds of data.dataSources) {
      const sEmoji = ds.source === "on-chain" ? "🔗" : "🧠";
      const cEmoji =
        ds.confidence === "high"
          ? "🟢"
          : ds.confidence === "medium"
            ? "🟡"
            : "🔴";
      lines.push(`  ${sEmoji}${cEmoji} ${ds.claim || "N/A"}`);
      lines.push(`     来源: ${ds.source} | 置信度: ${ds.confidence}`);
    }
    lines.push("");
  }

  // 6. 不确定项
  if (data.uncertainties && data.uncertainties.length > 0) {
    lines.push("❓ 模型不确定的地方");
    lines.push(SUBSEP);
    for (const u of data.uncertainties) {
      lines.push(`  ⚠️  ${u}`);
    }
    lines.push("");
  }

  // 7. 安全检查
  if (data.safetyChecks && data.safetyChecks.length > 0) {
    lines.push("🔒 签名前安全检查");
    lines.push(SUBSEP);
    data.safetyChecks.forEach((check, i) => {
      lines.push(`  ${i + 1}. ${check}`);
    });
    lines.push("");
  }

  // Gas 信息
  lines.push(
    `⛽ Gas: ${txData.gasUsed.toLocaleString()} @ ${txData.gasPriceGwei.toFixed(2)} Gwei`
  );
  lines.push(`💸 Gas 费用: ${txData.gasFeeEth.toFixed(6)} ETH`);
  lines.push(`📝 事件日志: ${txData.logsCount} 条`);
  if (txData.contractName)
    lines.push(`📄 合约名称: ${txData.contractName}`);
  lines.push(`   ABI 可用: ${txData.contractABIAvailable ? "✅" : "❌"}`);
  lines.push(`\n${SEP}\n`);

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.includes("--help") || args.includes("-h")) {
    console.log("用法: node explain.js <transaction_hash> [--json]");
    console.log("");
    console.log("示例:");
    console.log("  node explain.js 0x1234...abcd");
    console.log("  node explain.js 0x1234...abcd --json  (输出原始 JSON)");
    console.log("");
    console.log("环境变量:");
    console.log("  RPC_URL            - Ethereum JSON-RPC 端点");
    console.log("  ETHERSCAN_API_KEY  - Etherscan API Key");
    console.log("  OPENROUTER_API_KEY - OpenRouter API Key");
    console.log("  LLM_MODEL          - 模型名称");
    process.exit(0);
  }

  let txHash = args[0];
  const rawJson = args.includes("--json");

  if (!txHash.startsWith("0x")) txHash = "0x" + txHash;

  console.log(`\n⏳ 获取交易数据: ${txHash}`);

  try {
    // 1. 获取链上数据
    const txData = await fetchTransactionData(txHash);
    console.log(`✅ 链上数据获取完成 (区块 ${txData.blockNumber.toLocaleString()})`);

    // 2. 生成解释
    console.log("🧠 正在生成解释...");
    const explanation = await generateExplanation(txData);

    if (rawJson) {
      console.log(
        JSON.stringify({ txData, explanation }, null, 2)
      );
    } else {
      console.log(formatOutput(txData, explanation));
    }
  } catch (e) {
    console.error(`❌ 错误: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

main();
