#!/usr/bin/env node
/**
 * 只读 MCP Server — 最小实现
 *
 * 暴露两个工具：
 *   search_docs(query) — 搜索本地项目文档
 *   get_file(path)      — 读取白名单目录里的文件
 *
 * 安全约束：
 *   - 只读，不提供任何写入工具
 *   - get_file 只能读白名单目录下的文件
 *   - 所有调用写入日志
 *   - 错误明确返回
 *
 * 启动方式：node mcp-server.js
 * 传输方式：stdio（标准 MCP 协议）
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ========== 配置 ==========
const WHITELIST_DIRS = [
  path.resolve(__dirname, ".."),           // experiments/
  path.resolve(__dirname, "../.."),        // ai-web3-school-cohort-0/
];

const LOG_FILE = path.resolve(__dirname, "mcp-server.log");

// ========== 日志 ==========
function log(level, msg, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(LOG_FILE, line);
}

// ========== 安全校验 ==========
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return WHITELIST_DIRS.some((dir) => resolved.startsWith(dir + path.sep) || resolved === dir);
}

// ========== 工具实现 ==========

/**
 * search_docs — 在本地文档目录中搜索关键词
 * 参数：query (string)
 * 返回：匹配的文件列表（路径 + 匹配行预览）
 */
function searchDocs(query) {
  log("info", "searchDocs called", { query });

  if (!query || typeof query !== "string") {
    return { error: "INVALID_PARAM", message: "query must be a non-empty string" };
  }

  const results = [];
  const searchDirs = WHITELIST_DIRS;

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      searchInDir(dir, query, results, 50); // 最多返回 50 条
    } catch (err) {
      log("error", "searchDocs error", { dir, error: err.message });
    }
  }

  log("info", "searchDocs result", { query, count: results.length });
  return { query, count: results.length, results };
}

function searchInDir(dir, query, results, limit) {
  if (results.length >= limit) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= limit) return;

    // 跳过 node_modules 和隐藏目录
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      searchInDir(fullPath, query, results, limit);
    } else if (entry.isFile() && isTextFile(entry.name)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= limit) return;
          if (lines[i].toLowerCase().includes(query.toLowerCase())) {
            results.push({
              file: fullPath,
              line: i + 1,
              preview: lines[i].trim().slice(0, 120),
            });
          }
        }
      } catch (err) {
        // 跳过无法读取的文件
      }
    }
  }
}

function isTextFile(filename) {
  const textExts = [".md", ".txt", ".js", ".ts", ".json", ".yaml", ".yml", ".py", ".sh", ".sol", ".html", ".css", ".toml"];
  return textExts.some((ext) => filename.endsWith(ext));
}

/**
 * get_file — 读取白名单目录中的文件内容
 * 参数：filePath (string)
 * 返回：文件内容 + 来源路径
 */
function getFile(filePath) {
  log("info", "get_file called", { path: filePath });

  if (!filePath || typeof filePath !== "string") {
    return { error: "INVALID_PARAM", message: "path must be a non-empty string" };
  }

  if (!isPathAllowed(filePath)) {
    log("warn", "get_file blocked — path not in whitelist", { path: filePath });
    return {
      error: "ACCESS_DENIED",
      message: `Path "${filePath}" is not in the whitelist. Allowed directories: ${WHITELIST_DIRS.join(", ")}`,
    };
  }

  if (!fs.existsSync(filePath)) {
    return { error: "NOT_FOUND", message: `File not found: ${filePath}` };
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { error: "IS_DIRECTORY", message: `Path is a directory, not a file: ${filePath}` };
  }

  // 限制文件大小 1MB
  if (stat.size > 1024 * 1024) {
    return { error: "FILE_TOO_LARGE", message: `File exceeds 1MB limit (${stat.size} bytes)` };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    log("info", "get_file success", { path: filePath, size: stat.size });
    return {
      path: filePath,
      size: stat.size,
      content,
    };
  } catch (err) {
    log("error", "get_file read error", { path: filePath, error: err.message });
    return { error: "READ_ERROR", message: err.message };
  }
}

// ========== MCP 协议处理 ==========

const TOOLS_LIST = [
  {
    name: "search_docs",
    description: "Search local project documentation by keyword. Returns matching files with line previews.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or phrase" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_file",
    description: "Read a file from whitelisted directories. Only reads files under the project root. Returns file content and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path (must be within whitelisted directories)" },
      },
      required: ["path"],
    },
  },
];

function handleRequest(req) {
  const { id, method, params } = req;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "readonly-docs-server", version: "1.0.0" },
          },
        };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS_LIST } };

      case "tools/call": {
        const { name, arguments: args } = params;
        let result;

        switch (name) {
          case "search_docs":
            result = searchDocs(args.query);
            break;
          case "get_file":
            result = getFile(args.path);
            break;
          default:
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Unknown tool: ${name}` },
            };
        }

        // 检查是否有错误
        if (result && result.error) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: true,
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        };
    }
  } catch (err) {
    log("error", "Request handling error", { error: err.message, method });
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `Internal error: ${err.message}` },
    };
  }
}

// ========== 启动（stdio 传输） ==========

log("info", "MCP server starting", { whitelist: WHITELIST_DIRS });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (line) => {
  try {
    const req = JSON.parse(line.trim());
    const resp = handleRequest(req);
    if (resp) {
      process.stdout.write(JSON.stringify(resp) + "\n");
    }
  } catch (err) {
    log("error", "Failed to parse request", { line, error: err.message });
  }
});

rl.on("close", () => {
  log("info", "MCP server shutting down");
});
