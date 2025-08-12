# 文档处理集成工具

支持批量 LLM 处理、结构化解析、并发与重试、错误归档与重处理、文档转换、文本分割、CSV 合并等。

## 功能特性

- 🚀 **多 LLM 提供商**：OpenAI 兼容接口，支持自定义 `base_url` 与多模型选择
- 🧭 **两种输出模式**：
  - Classic：LLM 直接输出 CSV
  - Structured：LLM 输出 `rows JSON` → 本地校验/修复 → 转 CSV（可回退 Classic）
- ⚡ **并发与超时**：最大并发可配、连接/响应超时可配
- ♻️ **自动重试与错误分类**：HTTP/网络错误自动重试；失败按原因分类（429、5xx、超时、网络、校验等）
- 🧩 **错误归档与重处理闭环**：
  - 运行结束将失败文件按原因归档到 `error/<type>/`
  - 支持在“选择输入方式”中进入“错误重处理批次（按时间倒序）”，对失败样本再次处理
  - 成功后结果回写原时间戳目录；可自动清理 `error` 目录并更新 JSON 清单
- ✅ **质量控制**：CSV 规则校验、语义一致性校验、多样本投票/推荐
- 🔁 **回退策略**：结构化模式失败可回退 Classic
- 📊 **运行总结**：生成 `run_summary.json` 与 `run_summary.md`（可选 LLM 总结）
- 🔢 **Token 统计**：支持真实/估算用量记录
- 📄 **文档转换**：DOCX → Markdown
- ✂️ **文本分割**：正则与多级分割，交互式 UI
- 🔗 **CSV 合并**：交互式选择目录合并 CSV

## 项目结构

```
├── main.js                    # 主程序入口
├── config/
│   ├── config-loader.js       # 配置加载器
│   └── env.yaml.example       # 配置文件示例
├── modules/
│   ├── llm-client.js          # LLM 客户端（OpenAI 兼容，含自动重试）
│   ├── file-processor.js      # 文件处理模块
│   ├── structured-file-processor.js # 结构化处理（rows JSON → CSV）
│   ├── model-tester.js        # 模型测试模块
│   ├── text-splitter-ui.js    # 文本分割UI模块
│   └── ui-interactive.js      # 交互界面模块
├── utils/
│   ├── file-utils.js          # 文件工具
│   ├── errors.js              # 错误分类与归档工具
│   ├── error-cleanup.js       # 重处理后清理（清空 error 与更新清单）
│   ├── similarity.js          # 相似度计算
│   ├── text-splitter.js       # 文本分割工具
│   ├── token-counter.js       # Token计数器
│   ├── csv-merger.js          # CSV合并工具
│   └── logger.js              # 日志工具
├── tools/
│   ├── docx_to_md_converter.js # DOCX转MD转换器
│   └── text-splitter-cli.js   # 文本分割命令行工具
├── prompts/
│   └── Prompt.txt             # 系统提示词
├── data/                      # 数据目录
│   ├── input/                 # 输入文件目录
│   ├── output/                # 输出文件目录
│   ├── temp/                  # 临时文件目录
│   └── logs/                  # 日志文件目录
└── package.json
```

## 快速开始

### 1. 安装

```bash
# 克隆项目
git clone https://github.com/your-username/文档处理集成工具.git
cd 文档处理集成工具

# 安装依赖（Node >= 16）
npm install
```

### 2. 配置

复制配置文件并编辑：

```bash
# 复制配置文件
cp config/env.yaml.example config/env.yaml

# 编辑配置文件，填入您的API密钥
```

编辑 `config/env.yaml` 文件示例（节选）：

```yaml
# LLM提供商配置
providers:
  - name: "Gemini提供商"
    base_url: "https://your-provider.com"
    api_key: "your-api-key-here"
    models:
      - "gemini-2.5-flash"
      - "gemini-2.5-flash-lite"

  - name: "O3提供商"
    base_url: "https://another-provider.com"
    api_key: "your-second-api-key"
    models:
      - "o3-mini"

# 目录配置
directories:
  input_dir: "./data/input"
  output_dir: "./data/output"
  temp_dir: "./data/temp"

# 网络与重试
network:
  connect_timeout_ms: 3000
  response_timeout_ms: 60000
retry:
  enable_auto_retry: true
  max_retry_count: 3
  retry_delay_ms: 1000

# 处理模式
processing:
  default_mode: classic   # classic | structured
  allow_fallback: true
  fallback_mode: classic

# 结构化解析
structured:
  prompts_root: "./prompts/StructuredFileProcessor"
  default_prompt_version: "Version1"
  max_repair_attempts: 2

# 并发控制
concurrency:
  max_concurrent_requests: 16

# 校验配置
validation:
  enable_multiple_requests: false
  request_count: 3
  similarity_threshold: 0.8

# 错误清理（重处理成功后）
errors:
  export_input_copy: true
  cleanup:
    on_success: true
    prune_fixed_entries: true
    remove_empty_error_dir: true
```

### 3. 使用方法

#### 主程序（交互式界面）

```bash
# 启动主程序
node main.js
```

程序提供交互式菜单，包含：
- 🔄 批量 LLM 处理（Classic/Structured）
- 🧩 Colipot 预置方案
- 📄 DOCX → Markdown
- ✂️ 文本分割
- 📊 CSV 合并
- 🧪 模型测试

#### 独立工具使用

**1. DOCX 转 Markdown**
```bash
node tools/docx_to_md_converter.js
```

**2. 文本分割工具**
```bash
# 命令行版本
node tools/text-splitter-cli.js

# 交互式版本
node modules/text-splitter-ui.js
```

**3. CSV 合并工具**
```bash
node utils/csv-merger.js
```

## 使用教程（批量 LLM 处理）

1) 选择模型与输出模式（Classic/Structured）

2) 选择输入方式：
- 🎯 增强多选：文件/目录多选
- 📁 单目录：递归处理目录内所有支持文件
- 📄 多文件：手动多选文件
- 🛠 错误重处理批次：按时间倒序列出历史含 `error` 的批次，选中后自动收集失败文件再次处理（成功回写原目录）

3) 选择输出目录（重处理模式下跳过）

4) 可选配置：多次请求与相似度阈值、网络超时、结构化提示词版本与纠错回合

5) 运行结束自动生成：
- `run_summary.json` 与 `run_summary.md`
- 出错文件按类型归档在 `error/`

## 错误处理与重处理闭环

### 错误分类（示例）
- `rate_limit` (429)
- `server_error` (5xx)
- `client_error` (4xx)
- `timeout` / `network_error`
- `validation_error` / `parse_error`
- `fallback_failed`

### 输出目录结构（示例）
```
data/output/
  └── 2025-08-13T02-51-08/
      ├── 01张三.csv
      ├── 02李四.csv
      ├── run_summary.json
      ├── run_summary.md
      └── error/
          ├── error_manifest.json
          ├── client_error/
          │   ├── 01张三.md
          │   └── error.json
          └── fallback_failed/
              ├── 02李四.md
              └── error.json
```

### 重处理流程
1. 在“选择输入方式”中选择“🛠 错误重处理批次（按时间倒序）”
2. 选择某次 `runId` 的错误目录或手动选择 `error` 目录
3. 再次处理失败样本，成功结果回写原 `runId` 目录
4. 成功后自动清理：删除对应错误样本、更新 `error.json` 与 `error_manifest.json`（可配置为“移除”或“标记 fixed”）；若全修复则清空/删除 `error` 目录

### 🔧 DOCX转Markdown
- 将Word文档转换为Markdown格式
- 保留文档结构和格式
- 批量处理整个目录

### ✂️ 文本分割
- 支持按标题、段落等方式智能分割
- 可自定义分割规则
- 生成独立的文本片段文件

### 🔗 CSV合并
- 合并多个CSV文件
- 自动处理表头
- 支持自定义输出格式

### 🧪 模型测试
- 测试API连接状态
- 验证模型可用性
- 性能基准测试

## 配置说明

### 主要配置项

- **providers**: LLM提供商配置，支持多个API提供商
- **directories**: 目录配置，指定输入、输出、临时文件目录
- **concurrency**: 并发控制，设置最大并发请求数
- **validation**: 校验配置，启用多重验证和相似度阈值
- **retry**: 重试配置（429/5xx/网络错误等自动重试）
- **token_tracking**: Token统计，跟踪API使用量
- **errors**: 错误归档与重处理清理策略（见示例）

### 相似度验证

基于语义相似度的智能验证：

- **多重验证**：对同一内容发送多个请求
- **相似度计算**：使用余弦相似度比较回复
- **异常检测**：识别相似度低于阈值的异常回复
- **自动选择**：选择最一致的回复作为最终结果

## 支持的文件格式

### 输入格式
- `.txt` - 纯文本文件
- `.md` - Markdown文件
- `.docx` - Word 文档（运行时自动转文本，或先转换为 Markdown）

### 输出格式
- `.csv` - 标准CSV格式
- `.jsonl` - JSON Lines格式（临时文件）
- `.md` - Markdown格式（转换输出）

## 输出示例（Classic）

标准化的CSV格式输出：

```csv
编号,问题,答案,答题人,专业
"1","生态系统的组成","由生产者、消费者、分解者组成","学生A","生态学"
"2","食物链的定义","生物之间的捕食关系链","学生A","生态学"
```

## 系统要求

- **Node.js** >= 16.0.0
- **npm** >= 7.0.0

## 主要依赖（与 package.json 对齐）

- `axios`：HTTP 请求
- `openai`：OpenAI 兼容 SDK（可回退 axios）
- `inquirer`：交互式 CLI
- `js-yaml`：配置解析
- `chalk` `ora` `gradient-string` `boxen`：CLI 体验
- `papaparse`：CSV 处理
- `mammoth`：DOCX 提取
- `@xenova/transformers`：语义相似度
- `cli-table3`：表格展示

## 常见问题

### Q: 如何添加新的 LLM 提供商？
A: 在 `config/env.yaml` 的 `providers` 中增加条目，包含 `name/base_url/api_key/models`。

### Q: 如何调整并发处理数量？
A: 修改 `concurrency.max_concurrent_requests`。

### Q: 相似度阈值如何设置？
A: 在 `validation.similarity_threshold` 设置，建议 0.7~0.9。

### Q: 错误重处理如何选择？
A: 在“选择输入方式”时选择“🛠 错误重处理批次（按时间倒序）”。

## 许可证

MIT License

## 贡献指南

欢迎提交Issue和Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 更新日志

### v1.1.0
- ♻️ 加入错误归档与重处理闭环（按原因分目录、候选批次选择、成功清理与清单更新）
- 🔁 自动重试改进（HTTP/网络错误分类）
- 🧭 结构化解析工作流（JSON 修复回合 + 校验 + 回退）
- 📊 运行总结增强（错误统计）

### v1.0.0
- 初始版本发布：多提供商、DOCX→MD、文本分割、CSV 合并、相似度验证
