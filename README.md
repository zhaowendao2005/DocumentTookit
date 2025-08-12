# 文档处理集成工具

一个功能强大的文档处理集成工具，支持多种文档格式转换、文本分割、LLM批量处理等功能。

## 功能特性

- 🚀 **多LLM提供商支持**：支持多种API提供商（Gemini、O3等）
- 📄 **文档格式转换**：DOCX转Markdown格式
- ✂️ **智能文本分割**：支持按章节、段落等方式分割文本
- 📊 **批量处理**：支持大量文件的并发处理
- ✅ **自动校验**：多次LLM回复的相似度校验
- 🔧 **模块化设计**：各功能模块独立，便于扩展
- 📝 **CSV输出**：标准化的CSV格式输出结果

## 项目结构

```
├── main.js                    # 主程序入口
├── config/
│   ├── config-loader.js       # 配置加载器
│   └── env.yaml.example       # 配置文件示例
├── modules/
│   ├── llm-client.js          # LLM客户端模块
│   ├── file-processor.js      # 文件处理模块
│   ├── model-tester.js        # 模型测试模块
│   ├── text-splitter-ui.js    # 文本分割UI模块
│   └── ui-interactive.js      # 交互界面模块
├── utils/
│   ├── file-utils.js          # 文件工具
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

# 安装依赖
npm install
```

### 2. 配置

复制配置文件并编辑：

```bash
# 复制配置文件
cp config/env.yaml.example config/env.yaml

# 编辑配置文件，填入您的API密钥
```

编辑 `config/env.yaml` 文件示例：

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

# 校验配置
validation:
  enable_multiple_requests: true
  request_count: 3
  similarity_threshold: 0.8

# 并发控制
concurrency:
  max_concurrent_requests: 30
```

### 3. 使用方法

#### 主程序（交互式界面）

```bash
# 启动主程序
node main.js
```

程序提供交互式菜单，包含以下功能：
- 📄 批量文档处理（LLM处理）
- 🔧 DOCX转Markdown工具
- ✂️ 文本分割工具
- 🔗 CSV合并工具
- 🧪 模型连接测试

#### 独立工具使用

**1. DOCX转Markdown**
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

**3. CSV合并工具**
```bash
node utils/csv-merger.js
```

## 详细功能说明

### 📄 批量文档处理
- 支持`.txt`、`.md`文件的批量LLM处理
- 自动生成标准化CSV输出
- 支持多重验证和相似度检测
- 可配置并发处理数量

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
- **retry**: 重试配置，自动重试失败的请求
- **token_tracking**: Token统计，跟踪API使用量

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
- `.docx` - Word文档（需先转换为Markdown）

### 输出格式
- `.csv` - 标准CSV格式
- `.jsonl` - JSON Lines格式（临时文件）
- `.md` - Markdown格式（转换输出）

## 输出示例

标准化的CSV格式输出：

```csv
编号,问题,答案,答题人,专业
"1","生态系统的组成","由生产者、消费者、分解者组成","学生A","生态学"
"2","食物链的定义","生物之间的捕食关系链","学生A","生态学"
```

## 系统要求

- **Node.js** >= 16.0.0
- **npm** >= 7.0.0

## 主要依赖

- **@xenova/transformers** - 语义相似度计算
- **inquirer** - 交互式命令行界面
- **js-yaml** - YAML配置文件解析
- **axios** - HTTP请求处理
- **mammoth** - DOCX文件处理
- **csv-parser** - CSV文件解析
- **fast-csv** - CSV文件生成

## 常见问题

### Q: 如何添加新的LLM提供商？
A: 在`config/env.yaml`文件中的`providers`部分添加新的提供商配置即可。

### Q: 如何调整并发处理数量？
A: 修改`config/env.yaml`文件中的`concurrency.max_concurrent_requests`参数。

### Q: 相似度阈值如何设置？
A: 在`validation.similarity_threshold`中设置，建议值为0.7-0.9之间。

### Q: 如何查看处理日志？
A: 日志文件保存在`data/logs/`目录下，可以查看详细的处理记录。

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

### v1.0.0
- ✨ 初始版本发布
- 🚀 支持多LLM提供商
- 📄 实现DOCX转Markdown功能
- ✂️ 添加文本分割工具
- 🔗 添加CSV合并功能
- 🧪 添加模型测试功能
- ✅ 实现相似度验证算法
