const path = require('path');
const fs = require('fs');
const FileUtils = require('../utils/file-utils');
const SimilarityCalculator = require('../utils/similarity');
const TokenCounter = require('../utils/token-counter');
const LLMClient = require('./llm-client');

/**
 * 批量文件处理器：读取 -> 请求LLM -> 校验 -> 输出
 */
class FileProcessor {
  /**
   * @param {Object} options
   * @param {Object} options.config - 完整配置
   * @param {Object} options.logger - 可选日志器
   */
  constructor({ config, logger = console }) {
    this.config = config;
    this.logger = logger;
    this.client = new LLMClient({ providers: config.providers, retry: config.retry });
    this.sim = new SimilarityCalculator();
    this.tokenCounter = new TokenCounter();

    // 初始化 token 日志
    if (config.token_tracking?.save_token_logs && config.token_tracking?.log_file) {
      this.tokenCounter.setLogFile(config.token_tracking.log_file);
    }
  }

  /**
   * 主入口：并发处理目录内所有文件
   * @param {{ provider: string, model: string }} modelSel
   * @param {string} inputDir
   * @param {string} outputDir
   */
  async runBatch(modelSel, inputDir, outputDir) {
    // 保存最近一次交互配置的超时参数，供请求传递
    this.lastTimeouts = modelSel.timeouts || null;
    // 保存校验配置
    this.lastValidation = modelSel.validation || null;
    // 为本次运行创建时间戳输出子目录（东八区本地时间）
    const runId = this.formatLocalTimestamp('Asia/Shanghai');
    const runOutputDir = path.join(outputDir, runId);
    const tempDir = this.config.directories.temp_dir || path.join(path.dirname(outputDir), 'temp');
    this.ensureDir(runOutputDir);
    this.ensureDir(tempDir);

    const files = await FileUtils.scanFiles(inputDir, ['.txt', '.md', '.docx']);
    this.logger.info(`共发现可处理文件: ${files.length}`);
    if (files.length === 0) return { total: 0, succeeded: 0, failed: 0 };

    // 构建所有请求任务（扁平化）：文件数 × request_count
    const enableMulti = !!(this.lastValidation?.enableMultiple);
    const requestCount = enableMulti ? Math.min(Math.max(1, this.config.validation.request_count || 1), 10) : 1;
    
    // 调试输出
    this.logger.info(`多次校验开关: ${enableMulti ? '开启' : '关闭'}`);
    this.logger.info(`每文件请求次数: ${requestCount}`);
    this.logger.info(`校验配置: ${JSON.stringify(this.lastValidation)}`);

    const tasks = [];
    const contentCache = new Map();
    const fileMetaMap = new Map(); // rel -> { outPath, tempFilePath, results: [], errors: 0 }

    for (const file of files) {
      const rel = file.relativePath || path.relative(inputDir, file.path);
      const outPath = path.join(runOutputDir, rel.replace(path.extname(rel), '.csv'));
      const tempRelDir = path.join(tempDir, runId, path.dirname(rel));
      const tempFileBase = path.basename(rel, path.extname(rel));
      const tempFilePath = path.join(tempRelDir, `${tempFileBase}.jsonl`);
      this.ensureDir(path.dirname(tempFilePath));
      // 不删除已有文件，按运行ID区分，保留历史中间文件
      fileMetaMap.set(rel, { outPath, tempFilePath, results: [], errors: 0, file });

      const times = requestCount;
      for (let i = 0; i < times; i++) {
        tasks.push({ rel, file, repIndex: i, total: times });
      }
    }

    const totalTasks = tasks.length;
    this.logger.info(`本次将发送请求总数: ${totalTasks}`);

    // 并发控制
    const concurrency = Math.max(1, this.config.concurrency?.max_concurrent_requests || 1);
    let taskIndex = 0;

    const worker = async () => {
      while (true) {
        const current = tasks[taskIndex++];
        if (!current) break;

        const { rel, file, repIndex, total } = current;
        try {
          // 读取内容（带缓存）
          let content = contentCache.get(rel);
          if (content === undefined) {
            content = await FileUtils.readFile(file.path);
            contentCache.set(rel, content);
          }

          this.logger.info(`发送中: ${rel} [${repIndex + 1}/${total}] -> ${modelSel.provider}/${modelSel.model}`);
          const { text, raw } = await this.requestLLM(modelSel, content, (this.lastTimeouts || this.config.network || {}));

          // 记录 token 用量（优先真实 usage，回退估算）
          const usage = this.tokenCounter.getTokenUsage(
            raw,
            content,
            text,
            modelSel.model
          );
          this.logger.info(
            `已完成: ${rel} [${repIndex + 1}/${total}] 用量 in=${usage.inputTokens} out=${usage.outputTokens} total=${usage.totalTokens} (${usage.method === 'api_response' ? '真实' : '估算'})`
          );
          this.tokenCounter.recordTokenUsage({
            model: modelSel.model,
            provider: modelSel.provider,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            method: usage.method,
            estimated: usage.estimated,
          });

          // 写入中间 jsonl
          const meta = fileMetaMap.get(rel);
          fs.appendFileSync(meta.tempFilePath, JSON.stringify({ index: repIndex, text, usage }) + '\n', 'utf8');
          meta.results.push(text);
        } catch (err) {
          const meta = fileMetaMap.get(rel);
          meta.errors += 1;
          this.logger.error(`请求失败: ${rel} [${repIndex + 1}/${total}] - ${err.message}`);
        }
      }
    };

    const workers = Array.from({ length: concurrency }).map(() => worker());
    await Promise.all(workers);

    // 全部请求完成后，逐文件汇总与输出
    let succeeded = 0;
    let failed = 0;
    for (const [rel, meta] of fileMetaMap.entries()) {
      try {
        await this.finalizeFileResult(rel, meta, requestCount);
        succeeded++;
      } catch (e) {
        failed++;
        this.logger.error(`汇总失败: ${rel} - ${e.message}`);
      }
    }

    return { total: files.length, succeeded, failed };
  }

  /**
   * 处理单个文件：多次请求 -> 校验 -> 导出
   */
  async processSingleFile(modelSel, file, inputDir, outputDir, tempDir) {
    const absInputPath = file.path;
    const rel = file.relativePath || path.relative(inputDir, absInputPath);
    const outPath = path.join(outputDir, rel.replace(path.extname(rel), '.csv'));
    const tempRelDir = path.join(tempDir, path.dirname(rel));
    const tempFileBase = path.basename(rel, path.extname(rel));
    const tempFilePath = path.join(tempRelDir, `${tempFileBase}.jsonl`);

    const content = await FileUtils.readFile(absInputPath);

    // 如果启用多次请求，进行N次采样
    const enableMulti = !!this.config.validation?.enable_multiple_requests;
    const requestCount = enableMulti ? Math.min(Math.max(1, this.config.validation.request_count || 1), 10) : 1;
    const similarityThreshold = this.config.validation?.similarity_threshold ?? 0.8;

    this.logger.info(`准备发送: ${rel} (请求次数=${requestCount})`);
    // 中间文件：逐条写入，格式为 JSONL，每行一个结果 { index, text, usage }
    this.ensureDir(path.dirname(tempFilePath));
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    const appendJsonl = (obj) => fs.appendFileSync(tempFilePath, JSON.stringify(obj) + '\n', 'utf8');

    const results = [];
    for (let i = 0; i < requestCount; i++) {
      this.logger.info(`发送中: ${rel} [${i + 1}/${requestCount}] -> ${modelSel.provider}/${modelSel.model}`);
      const { text, raw } = await this.requestLLM(modelSel, content, (this.lastTimeouts || this.config.network || {}));

      // 记录 token 用量（优先真实 usage，回退估算）
      const usage = this.tokenCounter.getTokenUsage(
        raw,
        content,
        text,
        modelSel.model
      );
      this.logger.info(
        `已完成: ${rel} [${i + 1}/${requestCount}] 用量 in=${usage.inputTokens} out=${usage.outputTokens} total=${usage.totalTokens} (${usage.method === 'api_response' ? '真实' : '估算'})`
      );
      this.tokenCounter.recordTokenUsage({
        model: modelSel.model,
        provider: modelSel.provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        method: usage.method,
        estimated: usage.estimated,
      });

      appendJsonl({ index: i, text, usage });
      results.push(text);
    }

    // 若多次请求：做一致性与相似度校验
    let finalText = results[0] || '';
    if (enableMulti && results.length > 1) {
      const similarities = await this.sim.calculateBatchSimilarity(results);
      const avg = this.sim.calculateAverageSimilarity(similarities);
      const anomalies = this.sim.detectAnomalies(similarities, similarityThreshold);

      // 简单多数投票：出现次数最多的文本作为最终输出
      const counter = new Map();
      for (const r of results) counter.set(r, (counter.get(r) || 0) + 1);
      finalText = [...counter.entries()].sort((a, b) => b[1] - a[1])[0][0];

      this.logger.info(
        `一致性校验: 平均相似度=${avg.toFixed(3)}，异常对数=${anomalies.length}`
      );
    }

    // 优先从代码围栏中提取CSV；若无，则进行兜底生成
    const extracted = this.extractCsvFromText(finalText);
    const csv = extracted || this.ensureCSV(finalText);
    FileUtils.writeFile(outPath, csv, 'utf8');
    this.logger.info(`写出CSV: ${outPath}`);
  }

  /**
   * 发起一次LLM请求
   */
  async requestLLM(modelSel, content, timeouts = {}) {
    const systemPromptPath = this.config.system_prompt_file;
    let systemPrompt = '';
    try {
      systemPrompt = require('fs').readFileSync(systemPromptPath, 'utf8');
    } catch (e) {
      systemPrompt = '你是一个严格的CSV抽取助手。';
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ];

    const resp = await this.client.chatCompletion({
      providerName: modelSel.provider,
      model: modelSel.model,
      messages,
      extra: { temperature: 0.2 },
      timeouts: {
        connectTimeoutMs: timeouts.connectTimeoutMs || timeouts.connect_timeout_ms,
        responseTimeoutMs: timeouts.responseTimeoutMs || timeouts.response_timeout_ms,
      }
    });

    return resp; // { text, raw }
  }

  /**
   * 确保CSV格式（极简兜底）：若不是以逗号分隔或缺行头，则加表头
   */
  ensureCSV(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return '编号,问题,答案,答题人,专业\n';
    const hasHeader = /^\s*编号\s*,\s*问题\s*,\s*答案\s*,\s*答题人\s*,\s*专业/i.test(trimmed.split('\n')[0]);
    if (hasHeader) return trimmed;
    // 简单兜底：整段作为“答案”，编号=1，问题=空，答题人/专业=空
    const safe = trimmed.replace(/[\r\n]+/g, ' ');
    return `编号,问题,答案,答题人,专业\n"1","","${safe}","",""`;
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从文本中提取被代码围栏包裹的CSV内容
   * 优先匹配 ```csv ... ```（大小写不敏感），其次任意 ``` ... ``` 且首行含CSV表头
   */
  extractCsvFromText(text) {
    if (!text) return null;
    const src = String(text);

    // 1) 优先匹配 ```csv ... ```
    const csvFenceRegex = /```\s*csv\s*\n([\s\S]*?)\n```/gi;
    let m = csvFenceRegex.exec(src);
    if (m && m[1]) {
      const inner = m[1].trim();
      if (inner) return inner;
    }

    // 2) 退而求其次：任意代码围栏，且首行可能是表头
    const anyFenceRegex = /```\s*\n([\s\S]*?)\n```/g;
    let match;
    while ((match = anyFenceRegex.exec(src)) !== null) {
      const block = (match[1] || '').trim();
      if (!block) continue;
      const firstLine = block.split(/\r?\n/)[0].trim();
      // 允许表头含 5 或 6 列（兼容带“校验标识元数据”列的场景）
      const header5 = /^编号\s*,\s*问题\s*,\s*答案\s*,\s*答题人\s*,\s*专业\s*$/i;
      const header6 = /^编号\s*,\s*问题\s*,\s*答案\s*,\s*答题人\s*,\s*专业\s*,/i;
      if (header5.test(firstLine) || header6.test(firstLine)) {
        return block;
      }
    }

    return null;
  }

  /**
   * 生成东八区本地时间戳（YYYY-MM-DDTHH-mm-ss）
   */
  formatLocalTimestamp(timeZone = 'Asia/Shanghai') {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}`;
  }

  /**
   * 汇总并输出单文件结果
   */
  async finalizeFileResult(rel, meta, requestCount) {
    const { outPath, results } = meta;
    const enableMulti = (requestCount > 1) && !!(this.lastValidation?.enableMultiple);

    let finalText = results[0] || '';
    if (enableMulti && results.length > 1) {
      const similarities = await this.sim.calculateBatchSimilarity(results);
      const avg = this.sim.calculateAverageSimilarity(similarities);
      const anomalies = this.sim.detectAnomalies(similarities, this.config.validation?.similarity_threshold ?? 0.8);

      // 多数投票
      const counter = new Map();
      for (const r of results) counter.set(r, (counter.get(r) || 0) + 1);
      finalText = [...counter.entries()].sort((a, b) => b[1] - a[1])[0][0];

      this.logger.info(`一致性校验: ${rel} 平均相似度=${avg.toFixed(3)}，异常对数=${anomalies.length}`);
    }

    const extracted = this.extractCsvFromText(finalText);
    const csv = extracted || this.ensureCSV(finalText);
    this.ensureDir(path.dirname(outPath));
    FileUtils.writeFile(outPath, csv, 'utf8');
    this.logger.info(`写出CSV: ${outPath}`);
  }
}

module.exports = FileProcessor;


