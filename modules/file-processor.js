const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const FileUtils = require('../utils/file-utils');
const SimilarityCalculator = require('../utils/similarity');
const TokenCounter = require('../utils/token-counter');
const LLMClient = require('./llm-client');
const CsvMerger = require('../utils/csv-merger');
const CsvValidator = require('../utils/csv-validator');
const SemanticValidator = require('./semantic-validator');
const { ErrorClassifier, ErrorReporter } = require('../utils/errors');

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
    this.csvMerger = new CsvMerger(logger);
    this.csvValidator = new CsvValidator({ logger });
    this.semanticValidator = new SemanticValidator({ 
      logger,
      similarityThreshold: config.validation?.similarity_threshold || 0.8
    });

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
  async runBatch(modelSel, input, outputDir, options = {}) {
    // 保存最近一次交互配置的超时参数，供请求传递
    this.lastTimeouts = modelSel.timeouts || null;
    // 保存校验配置
    this.lastValidation = modelSel.validation || null;
    // 若UI提供了相似度阈值，则应用到语义校验器
    const uiSimTh = this.lastValidation?.similarityThreshold;
    if (typeof uiSimTh === 'number' && uiSimTh >= 0 && uiSimTh <= 1) {
      this.semanticValidator.config.similarityThreshold = uiSimTh;
      this.logger.info(`已应用交互式相似度阈值: ${uiSimTh}`);
    }
    // 为本次运行创建时间戳输出子目录（东八区本地时间）
    const runId = options.reuseRunOutputDir && options.fixedRunId
      ? options.fixedRunId
      : this.formatLocalTimestamp('Asia/Shanghai');
    const runOutputDir = options.reuseRunOutputDir && options.fixedRunOutputDir
      ? options.fixedRunOutputDir
      : path.join(outputDir, runId);
    const tempDir = this.config.directories.temp_dir || path.join(path.dirname(outputDir), 'temp');
    this.ensureDir(runOutputDir);
    this.ensureDir(tempDir);

    // 错误分类与归档
    const classifier = new ErrorClassifier();
    const reporter = new ErrorReporter(runOutputDir, { copyInput: (this.config.errors?.export_input_copy !== false) });

    // 支持数组或单一路径
    const inputs = Array.isArray(input) ? input : [input];
    const files = [];
    for (const target of inputs) {
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          const list = await FileUtils.scanFiles(target, ['.txt', '.md', '.docx']);
          files.push(...list);
        } else {
          // 单文件
          const dir = path.dirname(target);
          const rel = path.basename(target);
          files.push({ path: target, name: rel, size: stat.size, modified: stat.mtime, relativePath: rel });
        }
      } catch (e) {
        this.logger.warn(`输入无效或无法访问: ${target}`);
      }
    }
    this.logger.info(`共发现可处理文件: ${files.length}`);
    if (files.length === 0) return { total: 0, succeeded: 0, failed: 0 };

    // 构建所有请求任务（扁平化）：文件数 × request_count
    const enableMulti = !!(this.lastValidation?.enableMultiple);
    const uiRequestCount = this.lastValidation?.requestCount;
    const baseRequestCount = (typeof uiRequestCount === 'number' ? uiRequestCount : (this.config.validation.request_count || 1));
    const requestCount = enableMulti ? Math.min(Math.max(1, baseRequestCount), 10) : 1;
    
    // 调试输出
    this.logger.info(`多次校验开关: ${enableMulti ? '开启' : '关闭'}`);
    this.logger.info(`每文件请求次数: ${requestCount}`);
    this.logger.info(`校验配置: ${JSON.stringify(this.lastValidation)}`);

    const tasks = [];
    const contentCache = new Map();
    const fileMetaMap = new Map(); // rel -> { outPath, tempFilePath, results: [], errors: 0 }

    for (const file of files) {
      const rel = file.relativePath || path.basename(file.path);
      const outPath = path.join(runOutputDir, rel.replace(path.extname(rel), '.csv'));
      const tempRelDir = path.join(tempDir, runId, path.dirname(rel));
      const tempFileBase = path.basename(rel, path.extname(rel));
      const tempFilePath = path.join(tempRelDir, `${tempFileBase}.jsonl`);
      this.ensureDir(path.dirname(tempFilePath));
      // 不删除已有文件，按运行ID区分，保留历史中间文件
      fileMetaMap.set(rel, { outPath, tempFilePath, results: [], errors: 0, file });

      const times = requestCount;
      for (let i = 0; i < times; i++) {
        const taskId = options?.controller ? options.controller.createTaskId({ filename: rel }) : null;
        tasks.push({ rel, file, repIndex: i, total: times, taskId });
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
        if (options?.controller && options.controller.isStopped()) break;

        const { rel, file, repIndex, total, taskId } = current;
        try {
          // 读取内容（带缓存）
          let content = contentCache.get(rel);
          if (content === undefined) {
            content = await FileUtils.readFile(file.path);
            contentCache.set(rel, content);
          }

          this.logger.info(`发送中: ${rel} [${repIndex + 1}/${total}] -> ${modelSel.provider}/${modelSel.model}`);
          if (options?.controller) options.controller.updateTask(taskId, { stage: 'running' });
          if (options?.controller && options.controller.isStopped()) throw Object.assign(new Error('用户停止'), { code: 'USER_ABORT' });
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
          if (options?.controller) options.controller.updateTask(taskId, { stage: 'done' });
        } catch (err) {
          const meta = fileMetaMap.get(rel);
          meta.errors += 1;
          this.logger.error(`请求失败: ${rel} [${repIndex + 1}/${total}] - ${err.message}`);
          if (options?.controller) options.controller.updateTask(taskId, { stage: 'done' });
        }
      }
    };

    const workers = Array.from({ length: concurrency }).map(() => worker());
    await Promise.all(workers);

    // 全部请求完成后，逐文件汇总与输出
    let succeeded = 0;
    let failed = 0;
    const fileSummaries = [];
    for (const [rel, meta] of fileMetaMap.entries()) {
      try {
        if (options?.controller && options.controller.isStopped() && meta.results.length === 0) {
          throw Object.assign(new Error('用户停止，未产生结果'), { code: 'USER_ABORT' });
        }
        await this.finalizeFileResult(rel, meta, requestCount);
        succeeded++;
        fileSummaries.push({ filename: rel, mode: 'classic', succeeded: true, fallback: false });
      } catch (e) {
        failed++;
        this.logger.error(`汇总失败: ${rel} - ${e.message}`);
        const stage = (e && e.code === 'USER_ABORT') ? 'cancel' : 'validation';
        const errorInfo = classifier.classify(e, { stage });
        const fileAbs = meta.file?.path || '';
        // 记录错误并按原因入库
        reporter.addRecord({
          filename: rel,
          inputPath: fileAbs,
          stage,
          type: errorInfo.type,
          message: errorInfo.message,
          status: errorInfo.status,
          code: errorInfo.code,
          mode: 'classic',
          provider: modelSel?.provider,
          model: modelSel?.model,
          attemptsUsed: meta.errors || 0,
        });
        fileSummaries.push({ filename: rel, mode: 'classic', succeeded: false, fallback: false, error: e.message, errorType: errorInfo.type });
      }
    }

    // 询问是否合并CSV文件
    if (succeeded > 0) {
      await this.csvMerger.mergeCsvFilesInteractive(runOutputDir, runOutputDir);
    }

    const tokenStats = this.tokenCounter.getTokenStats();
    const manifest = reporter.finalize();
    const errorStats = manifest ? manifest.byType : {};
    return { total: files.length, succeeded, failed, runId, runOutputDir, files: fileSummaries, tokenStats, errorStats };
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

    // 如果启用多次请求，进行N次采样（优先使用交互式配置）
    const enableMulti = !!(this.lastValidation?.enableMultiple ?? this.config.validation?.enable_multiple_requests);
    const uiRequestCount2 = this.lastValidation?.requestCount;
    const baseRequestCount2 = (typeof uiRequestCount2 === 'number' ? uiRequestCount2 : (this.config.validation?.request_count || 1));
    const requestCount = enableMulti ? Math.min(Math.max(1, baseRequestCount2), 10) : 1;
    const simTh2 = (typeof this.lastValidation?.similarityThreshold === 'number'
      ? this.lastValidation.similarityThreshold
      : (this.config.validation?.similarity_threshold ?? 0.8));
    // 应用阈值到语义校验器（以便后续 validateMultipleSamples 一致）
    if (typeof simTh2 === 'number' && simTh2 >= 0 && simTh2 <= 1) {
      this.semanticValidator.config.similarityThreshold = simTh2;
    }

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
      const anomalies = this.sim.detectAnomalies(similarities, simTh2);

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
   * 汇总并输出单文件结果 - 新增用户决策流程
   */
  async finalizeFileResult(rel, meta, requestCount) {
    const { outPath, tempFilePath, results } = meta;
    const enableMulti = (requestCount > 1) && !!(this.lastValidation?.enableMultiple);

    this.logger.info(chalk.blue(`\n📋 处理文件结果: ${rel}`));

    // 1. 如果是单样本，直接处理
    if (!enableMulti || results.length <= 1) {
      return await this.processSingleSample(rel, results[0] || '', outPath, tempFilePath);
    }

    // 2. 先对每个样本进行CSV格式修复 (修复工作流顺序)
    this.logger.info(chalk.yellow(`🔧 预处理样本格式 (${results.length}个样本)`));
    const fixedResults = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      try {
        const csvValidation = await this.csvValidator.validateAndFix(result, `${rel}_sample_${i}`);
        fixedResults.push({
          originalIndex: i,
          original: result,
          fixed: csvValidation.fixed,
          confidence: csvValidation.confidence,
          issues: csvValidation.issues,
          autoFixed: csvValidation.autoFixed,
          isUsable: csvValidation.confidence > 0.4 || csvValidation.autoFixed.length > 0
        });
        
        this.logger.debug(`样本${i}: 置信度${(csvValidation.confidence * 100).toFixed(1)}%, 修复${csvValidation.autoFixed.length}个问题`);
      } catch (error) {
        this.logger.warn(`样本${i}格式修复失败: ${error.message}`);
        fixedResults.push({
          originalIndex: i,
          original: result,
          fixed: result,
          confidence: 0.1,
          issues: [{ type: 'fix_error', message: error.message }],
          autoFixed: [],
          isUsable: false
        });
      }
    }

    // 检查是否有可用样本
    const usableResults = fixedResults.filter(r => r.isUsable);
    if (usableResults.length === 0) {
      this.logger.warn(chalk.red(`⚠️  所有样本格式修复后仍不可用，使用简单投票逻辑`));
      return await this.processWithSimpleVoting(results, outPath, tempFilePath, rel);
    }

    this.logger.info(chalk.green(`✅ 格式预处理完成: ${usableResults.length}/${results.length}个样本可用`));

    // 3. 多样本语义校验 (使用修复后的内容)
    this.logger.info(chalk.yellow(`🔍 启动多样本语义校验 (${usableResults.length}个可用样本)`));
    const fixedContents = usableResults.map(r => r.fixed);
    const validationResult = await this.semanticValidator.validateMultipleSamples(fixedContents, rel);
    
    // 将原始样本信息附加到校验结果中
    validationResult.preprocessedSamples = fixedResults;
    validationResult.usableSamples = usableResults;

    // 4. 用户决策流程
    const userDecision = await this.getUserDecision(validationResult, rel);

    // 5. 根据用户决策处理
    switch (userDecision.action) {
      case 'accept_auto':
        return await this.processValidatedResult(validationResult, outPath, tempFilePath, rel);
      
      case 'manual_select':
        const selectedSample = results[userDecision.selectedIndex];
        return await this.processSingleSample(rel, selectedSample, outPath, tempFilePath);
      
      case 'skip_validation':
        // 使用原始的简单投票逻辑
        return await this.processWithSimpleVoting(results, outPath, tempFilePath, rel);
      
      default:
        throw new Error(`未知的用户决策: ${userDecision.action}`);
    }
  }

  /**
   * 用户决策流程 - 根据校验结果让用户选择处理方式
   */
  async getUserDecision(validationResult, filename) {
    // 显示校验结果摘要
    this.displayValidationSummary(validationResult, filename);

    // 根据置信度决定是否需要用户干预
    if (validationResult.confidence >= 0.8 && validationResult.selectedSample) {
      this.logger.info(chalk.green(`✅ 校验置信度高 (${(validationResult.confidence * 100).toFixed(1)}%)，自动采用推荐结果`));
      return { action: 'accept_auto' };
    }

    // 低置信度或有异常，提供用户选择
    const choices = [
      {
        name: `接受自动推荐 (置信度: ${(validationResult.confidence * 100).toFixed(1)}%)`,
        value: 'accept_auto',
        disabled: !validationResult.selectedSample
      },
      {
        name: '手动选择样本',
        value: 'manual_select'
      },
      {
        name: '跳过高级校验，使用简单投票',
        value: 'skip_validation'
      }
    ];

    const decision = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: `${filename} - 请选择处理方式:`,
      choices: choices.filter(choice => !choice.disabled)
    }]);

    // 如果选择手动选择，进一步询问选择哪个样本
    if (decision.action === 'manual_select') {
      const sampleChoices = validationResult.validSamples.map((sample, idx) => ({
        name: `样本${sample.index} (格式置信度: ${(sample.validationResult.confidence * 100).toFixed(1)}%, 长度: ${sample.content.length})`,
        value: sample.index
      }));

      const sampleDecision = await inquirer.prompt([{
        type: 'list',
        name: 'selectedIndex',
        message: '请选择样本:',
        choices: sampleChoices
      }]);

      decision.selectedIndex = sampleDecision.selectedIndex;
    }

    return decision;
  }

  /**
   * 显示校验结果摘要
   */
  displayValidationSummary(validationResult, filename) {
    console.log(chalk.cyan(`\n📊 ${filename} - 语义校验结果摘要:`));
    console.log(chalk.gray('─'.repeat(60)));
    
    console.log(`📈 总样本数: ${validationResult.totalSamples}`);
    console.log(`✅ 有效样本: ${validationResult.validSamples.length}`);
    console.log(`❌ 无效样本: ${validationResult.invalidSamples.length}`);
    
    if (validationResult.selectedSample) {
      console.log(`🏆 推荐样本: 样本${validationResult.selectedSample.index}`);
      console.log(`🎯 置信度: ${(validationResult.confidence * 100).toFixed(1)}%`);
    }

    if (validationResult.recommendations.length > 0) {
      console.log(`⚠️  建议数: ${validationResult.recommendations.length}`);
      validationResult.recommendations.forEach(rec => {
        const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        console.log(`   ${icon} ${rec.message}`);
      });
    }

    console.log(chalk.gray('─'.repeat(60)));
  }

  /**
   * 处理校验后的结果
   */
  async processValidatedResult(validationResult, outPath, tempFilePath, filename) {
    if (!validationResult.selectedSample) {
      throw new Error('没有可用的校验结果');
    }

    const selectedContent = validationResult.selectedSample.content;
    
    // 使用CSV校验器确保格式正确
    const csvValidation = await this.csvValidator.validateAndFix(selectedContent, filename);
    const finalCsv = csvValidation.fixed;

    // 保存校验报告
    const reportPath = tempFilePath.replace('.jsonl', '_validation_report.json');
    this.semanticValidator.exportValidationReport(validationResult, reportPath);

    // 写入最终CSV
    this.ensureDir(path.dirname(outPath));
    FileUtils.writeFile(outPath, finalCsv, 'utf8');
    
    this.logger.info(chalk.green(`✅ 写出CSV (经过语义校验): ${outPath}`));
    this.logger.info(chalk.gray(`📋 校验报告: ${reportPath}`));

    return { success: true, confidence: validationResult.confidence };
  }

  /**
   * 处理单样本
   */
  async processSingleSample(filename, content, outPath, tempFilePath) {
    const csvValidation = await this.csvValidator.validateAndFix(content, filename);
    const finalCsv = csvValidation.fixed;

    // 保存简单校验报告
    if (tempFilePath) {
      const reportPath = tempFilePath.replace('.jsonl', '_simple_validation.json');
      fs.writeFileSync(reportPath, JSON.stringify({
        filename,
        timestamp: new Date().toISOString(),
        validation: csvValidation,
        mode: 'single_sample'
      }, null, 2), 'utf8');
    }

    this.ensureDir(path.dirname(outPath));
    FileUtils.writeFile(outPath, finalCsv, 'utf8');
    
    this.logger.info(chalk.green(`✅ 写出CSV (单样本): ${outPath}`));
    return { success: true, confidence: csvValidation.confidence };
  }

  /**
   * 使用简单投票处理（兼容原逻辑）
   */
  async processWithSimpleVoting(results, outPath, tempFilePath, filename) {
    // 使用原始的多数投票逻辑
    const counter = new Map();
    for (const r of results) counter.set(r, (counter.get(r) || 0) + 1);
    const finalText = [...counter.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // 应用基本格式修复
    const csvValidation = await this.csvValidator.validateAndFix(finalText, filename);
    const finalCsv = csvValidation.fixed;

    this.ensureDir(path.dirname(outPath));
    FileUtils.writeFile(outPath, finalCsv, 'utf8');
    
    this.logger.info(chalk.green(`✅ 写出CSV (简单投票): ${outPath}`));
    return { success: true, confidence: 0.7 }; // 默认置信度
  }


}

module.exports = FileProcessor;


