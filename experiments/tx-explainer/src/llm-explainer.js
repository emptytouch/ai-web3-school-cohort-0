/**
 * LLM 解释生成模块
 * 将链上数据格式化为 prompt，调用 LLM 生成结构化解释
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LLM_MODEL =
  process.env.LLM_MODEL || "openrouter/anthropic/claude-sonnet-4";

function buildExplanationPrompt(txData) {
  const {
    txHash,
    status,
    blockNumber,
    from,
    to,
    valueEth,
    gasFeeEth,
    gasUsed,
    involvedProtocols,
    assets,
    input,
    logs,
  } = txData;

  let onChainData = `
=== 链上原始数据 (On-Chain Data) ===

交易哈希: ${txHash}
状态: ${status === "success" ? "成功" : "失败"}
区块: ${blockNumber}
发送方: ${from}
目标地址: ${to}
发送 ETH: ${valueEth.toFixed(6)} ETH
Gas 消耗: ${gasUsed.toLocaleString()}
Gas 费用: ${gasFeeEth.toFixed(6)} ETH

=== 交易 Input Data ===
类型: ${input.type}
调用函数: ${input.function || "N/A"}
函数选择器: ${input.selector || "N/A"}
`;

  if (input.decodedParams) {
    onChainData += `解码参数: ${JSON.stringify(input.decodedParams)}\n`;
  }

  onChainData += "\n=== 事件日志 (Event Logs) ===\n";
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    onChainData += `\n--- 事件 ${i + 1} ---\n`;
    onChainData += `  合约: ${log.address}`;
    if (log.knownAddress) onChainData += ` (${log.knownAddress})`;
    onChainData += `\n  事件: ${log.event}\n`;

    if (log.from) onChainData += `  From: ${log.from}\n`;
    if (log.to) onChainData += `  To: ${log.to}\n`;
    if (log.value) onChainData += `  数值: ${log.value}\n`;
    if (log.owner) onChainData += `  Owner: ${log.owner}\n`;
    if (log.spender) onChainData += `  Spender: ${log.spender}\n`;
    if (log.amount0In !== undefined) {
      onChainData += `  Amount0In: ${log.amount0In}\n`;
      onChainData += `  Amount1In: ${log.amount1In}\n`;
      onChainData += `  Amount0Out: ${log.amount0Out}\n`;
      onChainData += `  Amount1Out: ${log.amount1Out}\n`;
    }
  }

  onChainData += "\n=== 资产转移摘要 ===\n";
  if (assets.length > 0) {
    for (const asset of assets) {
      const amount = BigInt(asset.amountRaw);
      let formatted;
      if (amount > 10n ** 18n) {
        formatted = (Number(amount) / 1e18).toFixed(4);
      } else if (amount > 10n ** 6n) {
        formatted = (Number(amount) / 1e6).toFixed(4);
      } else {
        formatted = amount.toString();
      }
      onChainData += `  ${asset.token}: ${formatted} (from ${asset.from.slice(0, 10)}... to ${asset.to.slice(0, 10)}...)\n`;
    }
  } else {
    onChainData += "  未检测到代币转移事件\n";
  }

  if (involvedProtocols.length > 0) {
    onChainData += `\n=== 识别到的协议 ===\n`;
    for (const p of involvedProtocols) {
      onChainData += `  - ${p}\n`;
    }
  }

  return `你是一个专业的区块链交易分析助手。下面是一笔以太坊交易的链上原始数据。

${onChainData}

=== 任务 ===

请基于以上链上数据，生成一份结构化的交易解释。要求：

1. **用户发起了什么动作**
   - 用一句话概括用户做了什么 (例如: "用 1 ETH 兑换 USDC")
   - 说明调用的具体函数和协议

2. **涉及哪些资产和地址**
   - 列出所有涉及的代币和金额
   - 标注关键地址 (发送方、接收方、合约)
   - 标注哪些是已知协议/代币，哪些是未知合约

3. **信息来源标注**
   - 对每个关键信息，标注是「链上数据」还是「模型推断」
   - 链上数据 = 直接从交易 input/receipt/logs 中读取
   - 模型推断 = 基于数据模式、地址标签、经验推测

4. **模型不确定的地方**
   - 诚实列出所有不确定的信息
   - 例如: 未知合约的具体逻辑、代币精确名称、滑点设置等

5. **如果要签类似交易，用户应该检查什么**
   - 列出 3-5 个安全检查项
   - 例如: 合约是否开源验证、授权金额是否无限、目标地址是否可信等

=== 输出格式 ===

请用以下 JSON 格式输出 (确保是合法的 JSON):

{
  "summary": "一句话概括",
  "action": {
    "type": "swap/transfer/approve/bridge/other",
    "description": "详细描述",
    "protocol": "协议名称或 unknown",
    "functionCalled": "调用的函数"
  },
  "assets": [
    {
      "direction": "in/out",
      "token": "代币名称",
      "amount": "金额",
      "address": "代币合约地址"
    }
  ],
  "addresses": [
    {
      "role": "sender/receiver/contract/protocol",
      "address": "0x...",
      "name": "名称或 unknown",
      "verified": true/false
    }
  ],
  "dataSources": [
    {
      "claim": "某个信息",
      "source": "on-chain/inferred",
      "confidence": "high/medium/low"
    }
  ],
  "uncertainties": [
    "不确定的信息1",
    "不确定的信息2"
  ],
  "safetyChecks": [
    "检查项1",
    "检查项2",
    "检查项3"
  ]
}

只输出 JSON，不要有其他内容。`;
}

export async function generateExplanation(txData) {
  if (!OPENROUTER_API_KEY) {
    return {
      error: "OPENROUTER_API_KEY not set",
      fallback: generateFallbackExplanation(txData),
    };
  }

  const prompt = buildExplanationPrompt(txData);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          "https://github.com/emptytouch/ai-web3-school-cohort-0",
        "X-Title": "TX Explainer",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "你是一个专业的区块链交易分析助手。只输出合法的 JSON，不要输出 markdown 或其他格式。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    let content = result.choices[0].message.content.trim();

    // 清理 markdown 标记
    if (content.startsWith("```")) {
      content = content.split("\n").slice(1).join("\n");
      if (content.endsWith("```")) {
        content = content.slice(0, -3);
      }
      content = content.trim();
    }

    return JSON.parse(content);
  } catch (e) {
    return {
      error: `LLM error: ${e.message}`,
      fallback: generateFallbackExplanation(txData),
    };
  }
}

function generateFallbackExplanation(txData) {
  const { input, assets, involvedProtocols, from, to } = txData;

  let actionType = "unknown";
  let actionDesc = "未知操作";

  const func = input.function || "";
  if (func.includes("swap")) {
    actionType = "swap";
    actionDesc = "代币兑换";
  } else if (func.includes("transfer")) {
    actionType = "transfer";
    actionDesc = "代币转账";
  } else if (func.includes("approve")) {
    actionType = "approve";
    actionDesc = "代币授权";
  } else {
    actionType = "contractCall";
    actionDesc = `合约调用: ${func}`;
  }

  return {
    summary: `${actionDesc} - ${assets.length} 个资产转移事件`,
    action: {
      type: actionType,
      description: actionDesc,
      protocol: involvedProtocols[0] || "unknown",
      functionCalled: func || "N/A",
    },
    assets: assets.map((a) => ({
      direction: "unknown",
      token: a.token,
      amount: a.amountRaw,
      address: a.tokenAddress,
    })),
    addresses: [
      { role: "sender", address: from, name: "Transaction Sender", verified: false },
      {
        role: "receiver",
        address: to,
        name: involvedProtocols[0] || "unknown",
        verified: involvedProtocols.length > 0,
      },
    ],
    dataSources: [
      { claim: "交易基本信息", source: "on-chain", confidence: "high" },
      { claim: "事件日志", source: "on-chain", confidence: "high" },
      { claim: "动作类型", source: "inferred", confidence: "medium" },
    ],
    uncertainties: [
      "LLM 不可用，使用规则推断",
      "代币精确名称和金额需要 ABI 解码",
      "未知合约的具体行为",
    ],
    safetyChecks: [
      "确认目标合约地址是否正确",
      "检查授权金额是否为无限授权",
      "确认 Gas 费用是否合理",
      "验证合约是否开源验证",
    ],
  };
}
