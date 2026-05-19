# 模型对比：Claude / Cursor / Qoder

> 记录时间：2026-05-19
> 基于个人使用体验 + Handbook LLM 章节知识

## 各平台当前使用的模型

| 平台 | 背后模型 | 特点 |
|------|---------|------|
| **Claude** | Anthropic Claude 系列（Sonnet / Opus / Haiku） | 长上下文能力强，代码理解好，安全对齐严格 |
| **Cursor** | 多模型可选（Claude / GPT-4o / Gemini 等） | IDE 深度集成，代码补全 + Chat + Agent 模式 |
| **Qoder** | 多模型可选（类似 Cursor 的竞品） | 国产 AI IDE，对中文场景优化 |

## 从 Handbook 视角看模型差异

### 1. 上下文窗口（Context Window）
- **Claude**：200K tokens 上下文，适合长文档分析
- **Cursor**：取决于选择的模型，GPT-4o 约 128K
- **Qoder**：类似 Cursor，取决于底层模型

**实际影响**：分析大型合约代码库时，Claude 的长上下文优势明显。
但根据 Handbook 所说，"页面短 ≠ token 少"，代码和 JSON 很吃 token。

### 2. 幻觉倾向（Hallucination）
- **Claude**：幻觉相对较少，会主动说"我不确定"
- **GPT-4o**：代码生成强，但有时会编造不存在的 API
- **国产模型**：中文理解好，但技术细节可能不够精确

**实际影响**：写合约代码时，一定要验证模型生成的 API 和函数签名。
正如 Handbook 说的："模型输出是候选结果，不是事实本身"。

### 3. 工具调用能力（Tool Use）
- **Claude**：原生支持 tool use，适合 Agent 场景
- **Cursor**：通过 IDE 集成实现"伪工具调用"（读文件、执行命令）
- **Qoder**：类似 Cursor

**实际影响**：如果要构建 AI × Web3 Agent，Claude 的工具调用能力更适合。
Cursor/Qoder 更适合作为编码助手。

### 4. 代码 vs 自然语言
- **Claude**：平衡型，代码和自然语言都不错
- **Cursor**：代码场景优化更好（毕竟是 IDE）
- **Qoder**：中文注释和文档生成可能更好

## 关键认知

> 这些工具的本质区别不是"哪个更聪明"，而是：
> 1. **上下文管理策略不同** — 能塞多少信息进去
> 2. **工具集成深度不同** — 能不能调用外部工具
> 3. **幻觉处理方式不同** — 会不会编造，编造了怎么发现
>
> 正如 Handbook 说的：LLM 是推理层，不是真相源。
> 选工具时，关键不是模型能力上限，而是**你能不能有效校验它的输出**。

## 与 DApp 开发的关联

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 写 Solidity 合约 | Cursor + Claude | 代码补全 + 长上下文分析 |
| 理解复杂协议文档 | Claude | 长上下文 + 幻觉少 |
| 调试交易逻辑 | Claude | 推理能力强 |
| 生成中文注释/文档 | Qoder 或 Claude | 中文支持好 |
| 构建 Agent 自动化 | Claude | 原生 tool use 支持 |
