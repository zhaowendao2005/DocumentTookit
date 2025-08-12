# 批量LLM处理工具

一个专业的批量LLM处理工具，支持多提供商、错配检测和语义相似度验证。

## 功能特性

- 🚀 **多LLM提供商支持**：OpenAI、Claude、本地模型等
- 🔍 **智能错配检测**：基于语义相似度的错配识别
- 📊 **批量处理**：支持大量文件的并发处理
- ✅ **自动校验**：多次LLM回复的自动校验和纠错
- 📝 **详细报告**：生成完整的处理报告和修正建议
- 🎯 **专业领域**：专为动物学作业批改优化

## 项目结构

```
├── main.js                    # 中心程序 - 主入口
├── config/
│   ├── config-loader.js       # 配置加载器
│   └── env.yaml              # 配置文件
├── modules/
│   ├── llm-chat.js           # LLM对话模块
│   ├── file-processor.js     # 文件处理模块
│   ├── mismatch-detector.js  # 错配检测模块
│   ├── ui-interactive.js     # 交互界面模块
│   └── report-generator.js   # 报告生成模块
├── utils/
│   ├── file-utils.js         # 文件工具
│   ├── similarity.js         # 相似度计算
│   └── logger.js             # 日志工具
├── prompts/
│   └── Prompt.txt            # 系统提示词
├── input/                    # 输入文件目录
├── output/                   # 输出文件目录
└── package.json
```

## 安装

```bash
# 克隆项目
git clone https://github.com/biolabtoolkit/batch-llm-processor.git
cd batch-llm-processor

# 安装依赖
npm install

# 配置API密钥
# 编辑 config/env.yaml 文件，填入您的API密钥
```

## 配置

编辑 `config/env.yaml` 文件：

```yaml
# LLM提供商配置
providers:
  - name: "OpenAI"
    base_url: "https://api.openai.com/v1"
    api_key: "your-openai-key"
    models:
      - "gpt-4"
      - "gpt-3.5-turbo"

# 目录配置
directories:
  input_dir: "./input"
  output_dir: "./output"

# 校验配置
validation:
  enable_multiple_requests: true
  request_count: 3
  similarity_threshold: 0.8
```

## 使用方法

```bash
# 启动程序
npm start

# 开发模式
npm run dev
```

## 工作流程

1. **启动程序**：选择LLM模型和配置
2. **选择目录**：指定输入和输出目录
3. **批量处理**：自动处理所有文件
4. **错配检测**：识别和修正错配问题
5. **生成报告**：输出处理结果和修正建议

## 错配检测算法

基于语义相似度的智能错配检测：

- **位置比较**：比较同一位置在不同回复中的差异
- **语义分析**：使用@xenova/transformers进行语义相似度计算
- **异常检测**：识别相似度明显偏低的异常值
- **自动修正**：使用出现次数最多的值作为正确值

## 支持的文件格式

- `.txt` - 纯文本文件
- `.md` - Markdown文件
- `.docx` - Word文档

## 输出格式

程序会生成标准化的CSV格式输出：

```csv
编号,问题,答案,答题人,专业
"1","动物分类依据","根据形态特征分类","张三","生物科学"
"2","物种定义","生物分类基本单位","张三","生物科学"
```

## 依赖项

- Node.js >= 16.0.0
- @xenova/transformers - 语义相似度计算
- inquirer - 交互式命令行界面
- js-yaml - YAML配置文件解析
- axios - HTTP请求
- mammoth - DOCX文件处理

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request！

## 更新日志

### v1.0.0
- 初始版本发布
- 支持多LLM提供商
- 实现错配检测算法
- 添加批量处理功能
