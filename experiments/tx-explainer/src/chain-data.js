/**
 * 链上数据获取模块
 * 通过 JSON-RPC 和 Etherscan API 获取交易详情、事件日志和合约 ABI
 */

import { ethers } from "ethers";
import https from "https";
import http from "http";

// ─── 环境变量 ──────────────────────────────────────────────────────────────────

const DEFAULT_RPCS = [
  "https://eth.llamarpc.com",
  "https://rpc.mevblocker.io",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

const RPC_URL = process.env.RPC_URL || DEFAULT_RPCS[0];
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// ─── 常用事件签名 ───────────────────────────────────────────────────────────────

const EVENT_SIGNATURES = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
    "Transfer(address,address,uint256)",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925":
    "Approval(address,address,uint256)",
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31":
    "ApprovalForAll(address,address,bool)",
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67":
    "Swap(address,uint256,uint256,uint256,uint256,address)",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822":
    "Swap(address,uint256,uint256,uint256,uint256,address)",
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f":
    "Mint(address,uint256,uint256)",
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496":
    "Burn(address,uint256,uint256,address)",
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c":
    "Deposit(address,uint256)",
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65":
    "Withdrawal(address,uint256)",
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0":
    "OwnershipTransferred(address,address)",
};

// 常见函数选择器
const FUNCTION_SIGNATURES = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x70a08231": "balanceOf(address)",
  "0xdd62ed3e": "allowance(address,address)",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
  "0x313ce567": "decimals()",
  "0x18160ddd": "totalSupply()",
  "0xfb3bdb41": "swapETHForExactTokens(uint256,address[],address,uint256)",
  "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
  "0x18cbafe5": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "0x791ac947": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  "0xb6f9de95": "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
};

// 已知协议/代币地址
const KNOWN_ADDRESSES = {
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2 Router",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 Router",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 Router 2",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch Router V5",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange Proxy",
  "0x881d40237659c251811cec9c364ef91dc08d300c": "Metamask Swap Router",
  "0x1f98431c8ad98523631ae4a59f267346ea31f984": "Uniswap V3 Factory",
  "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f": "Uniswap V2 Factory",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
};

// ─── HTTP 工具 ─────────────────────────────────────────────────────────────────

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 30000, ...options }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

// ─── Etherscan API ─────────────────────────────────────────────────────────────

async function getEtherscanABI(address) {
  if (!ETHERSCAN_API_KEY) return null;
  try {
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
    const data = await fetchJSON(url);
    if (data.status === "1" && data.result) {
      return JSON.parse(data.result);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function getEtherscanContractName(address) {
  if (!ETHERSCAN_API_KEY) return null;
  try {
    const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
    const data = await fetchJSON(url);
    if (data.status === "1" && data.result && data.result[0]) {
      return data.result[0].ContractName || null;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// ─── 交易数据获取 ───────────────────────────────────────────────────────────────

export async function fetchTransactionData(txHash) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. 获取交易详情
  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error(`Transaction not found: ${txHash}`);

  // 2. 获取交易回执
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`Transaction receipt not found: ${txHash}`);

  // 3. 解析 input data
  const inputDecoded = decodeInputData(tx.data);

  // 4. 解析事件日志
  const decodedLogs = [];
  for (const log of receipt.logs) {
    decodedLogs.push(decodeEventLog(log));
  }

  // 5. 获取合约信息
  const toAddress = tx.to;
  let contractABI = null;
  let contractName = null;
  let isContract = false;

  if (toAddress) {
    const code = await provider.getCode(toAddress);
    isContract = code && code !== "0x";
    if (isContract) {
      contractABI = await getEtherscanABI(toAddress);
      contractName = await getEtherscanContractName(toAddress);
    }
  }

  // 6. 识别协议
  const involvedProtocols = new Set();
  const involvedAddresses = new Set();

  if (toAddress) {
    const name = KNOWN_ADDRESSES[toAddress.toLowerCase()];
    if (name) involvedProtocols.add(name);
    involvedAddresses.add(toAddress);
  }

  for (const log of decodedLogs) {
    const name = KNOWN_ADDRESSES[log.address.toLowerCase()];
    if (name) involvedProtocols.add(name);
    involvedAddresses.add(log.address);
  }

  // 7. 提取资产转移
  const assets = [];
  for (const log of decodedLogs) {
    if (log.event && log.event.startsWith("Transfer")) {
      const tokenName =
        KNOWN_ADDRESSES[log.address.toLowerCase()] ||
        `Token(${log.address.slice(0, 10)}...)`;
      assets.push({
        token: tokenName,
        tokenAddress: log.address,
        amountRaw: log.value?.toString() || "0",
        from: log.from || "unknown",
        to: log.to || "unknown",
      });
    }
  }

  // 8. 构建结果
  const gasUsed = Number(receipt.gasUsed);
  const gasPrice = Number(receipt.gasPrice || tx.gasPrice || 0n);
  const gasFee = Number(ethers.formatEther(BigInt(gasUsed) * BigInt(gasPrice)));

  return {
    txHash,
    status: receipt.status === 1 ? "success" : "failed",
    blockNumber: Number(receipt.blockNumber),
    from: tx.from,
    to: toAddress || "Contract Creation",
    valueEth: Number(ethers.formatEther(tx.value || 0n)),
    gasUsed,
    gasPriceGwei: gasPrice / 1e9,
    gasFeeEth: gasFee,
    nonce: tx.nonce,
    input: inputDecoded,
    logsCount: receipt.logs.length,
    logs: decodedLogs,
    contractName: contractName || null,
    contractABIAvailable: contractABI !== null,
    involvedProtocols: [...involvedProtocols],
    involvedAddresses: [...involvedAddresses],
    assets,
  };
}

// ─── Input Data 解码 ───────────────────────────────────────────────────────────

function decodeInputData(data) {
  if (!data || data === "0x") {
    return { type: "transfer", function: null, params: {} };
  }

  const selector = data.slice(0, 10).toLowerCase();
  const calldata = data.slice(10);

  const funcName =
    FUNCTION_SIGNATURES[selector] || `unknown(0x${selector.slice(2)})`;

  const result = {
    type: "contractCall",
    function: funcName,
    selector,
    calldata: calldata || null,
  };

  // 尝试解码参数
  if (calldata && calldata.length >= 64) {
    const params = [];
    for (let i = 0; i < calldata.length; i += 64) {
      const chunk = calldata.slice(i, i + 64);
      if (chunk.length === 64) {
        const val = BigInt("0x" + chunk);
        // 如果值在地址范围内
        if (val > 0n && val < 2n ** 160n) {
          params.push("0x" + chunk.slice(24));
        } else {
          params.push(val.toString());
        }
      }
    }
    result.decodedParams = params;
  }

  return result;
}

// ─── 事件日志解码 ───────────────────────────────────────────────────────────────

function decodeEventLog(log) {
  const topics = log.topics || [];
  const data = log.data || "0x";
  const address = log.address || "";

  const eventSig = topics[0] || "";
  const eventName =
    EVENT_SIGNATURES[eventSig] ||
    `UnknownEvent(0x${eventSig.slice(2, 10)}...)`;

  const decoded = {
    address,
    event: eventName,
    eventSignature: eventSig,
    topics,
    data,
    knownAddress: KNOWN_ADDRESSES[address.toLowerCase()] || null,
  };

  // 解码 Transfer 事件
  if (eventName.startsWith("Transfer") && topics.length >= 4) {
    decoded.from = "0x" + topics[1].slice(26);
    decoded.to = "0x" + topics[2].slice(26);
    decoded.value = BigInt(topics[3]).toString();
  } else if (eventName.startsWith("Transfer") && topics.length === 3) {
    decoded.from = "0x" + topics[1].slice(26);
    decoded.to = "0x" + topics[2].slice(26);
    decoded.value = data !== "0x" ? BigInt(data).toString() : "0";
  }
  // 解码 Approval 事件
  else if (eventName.startsWith("Approval") && !eventName.startsWith("ApprovalForAll") && topics.length >= 4) {
    decoded.owner = "0x" + topics[1].slice(26);
    decoded.spender = "0x" + topics[2].slice(26);
    decoded.value = BigInt(topics[3]).toString();
  }
  // 解码 Swap 事件
  else if (eventName.startsWith("Swap") && topics.length >= 3) {
    decoded.sender = "0x" + topics[1].slice(26);
    decoded.to = "0x" + topics[2].slice(26);
    if (data && data !== "0x" && data.length >= 258) {
      decoded.amount0In = BigInt("0x" + data.slice(2, 66)).toString();
      decoded.amount1In = BigInt("0x" + data.slice(66, 130)).toString();
      decoded.amount0Out = BigInt("0x" + data.slice(130, 194)).toString();
      decoded.amount1Out = BigInt("0x" + data.slice(194, 258)).toString();
    }
  }

  return decoded;
}
