const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const FileUtils = require('../utils/file-utils');
const CsvValidator = require('../utils/csv-validator');
const SemanticValidator = require('./semantic-validator');
const LLMClient = require('./llm-client');
const TokenCounter = require('../utils/token-counter');
const JsonSchemaValidator = require('./json-schema-validator');
const JsonUtils = require('../utils/json-utils');

/**
 * 结构化文件处理器：LLM 输出 JSON(rows) → 本地校验/修复 → CSV → 进入现有校验/语义一致性
 */
class StructuredFileProcessor {
  constructor({ config, logger = console }) {
    this.config = config;
    this.logger = logger;
    this.client = new LLMClient({ providers: config.providers, retry: config.retry });
    this.csvValidator = new CsvValidator({ logger });
    this.semanticValidator = new SemanticValidator({ logger, similarityThreshold: config.validation?.similarity_threshold || 0.8 });
    this.tokenCounter = new TokenCounter();
    if (config.token_tracking?.save_token_logs && config.token_tracking?.log_file) {
      this.tokenCounter.setLogFile(config.token_tracking.log_file);
    }

    this.schemaValidator = new JsonSchemaValidator({ logger });
  }

  /**
   * 主入口：并发处理目录/文件（与经典处理器返回结构保持一致）
   */
  async runBatch(modelSel, input, outputDir, options = {}) {
    const runId = this._formatLocalTimestamp('Asia/Shanghai');
    const runOutputDir = path.join(outputDir, runId);
    const tempRoot = this.config.directories.temp_dir || path.join(path.dirname(outputDir), 'temp');
    this._ensureDir(runOutputDir);
    this._ensureDir(tempRoot);

    const inputs = Array.isArray(input) ? input : [input];
    const files = [];
    for (const target of inputs) {
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          const list = await FileUtils.scanFiles(target, ['.txt', '.md', '.docx']);
          files.push(...list);
        } else {
          const rel = path.basename(target);
          files.push({ path: target, name: rel, size: stat.size, modified: stat.mtime, relativePath: rel });
        }
      } catch {
        this.logger.warn(`输入无效或无法访问: ${target}`);
      }
    }
    if (files.length === 0) return { total: 0, succeeded: 0, failed: 0 };

    const promptVersion = options.promptVersion || this.config.structured?.default_prompt_version || 'v1.0';
    const maxRepairAttempts = Math.max(0, Math.min(3, Number(options.repairAttempts ?? this.config.structured?.max_repair_attempts ?? 2)));

    // 构建任务并发执行（统一一起发送，而非逐个分批）
    const concurrency = Math.max(1, this.config.concurrency?.max_concurrent_requests || 1);
    const tasks = files.map((file) => ({ file }));
    let index = 0;

    const stats = { total: files.length, succeeded: 0, failed: 0, fallback: 0, files: [] };

    const worker = async () => {
      while (true) {
        const current = tasks[index++];
        if (!current) break;
        const file = current.file;
        const rel = file.relativePath || path.basename(file.path);
        const outPath = path.join(runOutputDir, rel.replace(path.extname(rel), '.csv'));
        const tempDir = path.join(tempRoot, runId, path.dirname(rel));
        this._ensureDir(tempDir);
        let record = { filename: rel, mode: 'structured', succeeded: false, fallback: false, error: null };
        try {
          const content = await FileUtils.readFile(file.path);
          const { finalCsv, repairAttemptsUsed, validationErrors } = await this._processOneFile({ modelSel, content, filename: rel, tempDir, promptVersion, maxRepairAttempts });
          FileUtils.writeFile(outPath, finalCsv, 'utf8');
          this.logger.info(chalk.green(`✅ 写出CSV: ${outPath}`));
          record.succeeded = true;
          record.repairAttemptsUsed = repairAttemptsUsed;
          record.validationErrors = validationErrors || [];
          stats.succeeded++;
        } catch (e) {
          record.error = e.message;
          this.logger.warn(chalk.yellow(`结构化模式失败: ${rel} - ${e.message}`));
          if (this.config.processing?.allow_fallback && (this.config.processing?.fallback_mode === 'classic')) {
            try {
              const FileProcessor = require('./file-processor');
              const classic = new FileProcessor({ config: this.config, logger: this.logger });
              await classic.processSingleFile(modelSel, { path: file.path, relativePath: rel }, path.dirname(file.path), runOutputDir, tempRoot);
              this.logger.info(chalk.green(`🔁 已回退经典模式成功: ${rel}`));
              record.fallback = true;
              stats.fallback++;
              stats.succeeded++;
            } catch (ee) {
              this.logger.error(`回退经典模式也失败: ${rel} - ${ee.message}`);
              stats.failed++;
            }
          } else {
            stats.failed++;
          }
        }
        stats.files.push(record);
      }
    };

    const workers = Array.from({ length: concurrency }).map(() => worker());
    await Promise.all(workers);

    const tokenStats = this.tokenCounter.getTokenStats();
    return { total: stats.total, succeeded: stats.succeeded, failed: stats.failed, fallback: stats.fallback, files: stats.files, runId, runOutputDir, tokenStats };
  }

  async _processOneFile({ modelSel, content, filename, tempDir, promptVersion, maxRepairAttempts }) {
    // 1) 构造 messages
    const promptsRoot = this.config.structured?.prompts_root || './prompts/StructuredFileProcessor';
    const systemPath = path.join(promptsRoot, promptVersion, 'system.rows.md');
    const repairPath = path.join(promptsRoot, promptVersion, 'repair.rows.md');
    const schemaPath = path.join(promptsRoot, promptVersion, 'rows.schema.json');
    const systemPrompt = fs.existsSync(systemPath) ? fs.readFileSync(systemPath, 'utf8') : '仅返回形如 {"rows": [...]} 的JSON';
    // 延迟加载版本内 Schema
    if (fs.existsSync(schemaPath)) {
      try { this.schemaValidator.loadSchema(schemaPath); } catch (e) { this.logger.warn(`加载版本Schema失败: ${e.message}`); }
    } else {
      // 回退到全局 schema_path（兼容旧配置）
      const globalSchema = this.config.structured?.schema_path;
      if (globalSchema && fs.existsSync(globalSchema)) {
        try { this.schemaValidator.loadSchema(globalSchema); } catch (e) { this.logger.warn(`加载全局Schema失败: ${e.message}`); }
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ];

    // 2) 请求
    this.logger.info(`发送中: ${filename} -> ${modelSel.provider}/${modelSel.model}`);
    const { text, raw } = await this.client.chatCompletion({
      providerName: modelSel.provider,
      model: modelSel.model,
      messages,
      extra: { temperature: 0.1 },
      timeouts: {
        connectTimeoutMs: modelSel?.timeouts?.connectTimeoutMs ?? this.config.network?.connect_timeout_ms,
        responseTimeoutMs: modelSel?.timeouts?.responseTimeoutMs ?? this.config.network?.response_timeout_ms,
      }
    });
    const usage = this.tokenCounter.getTokenUsage(raw, content, text, modelSel.model);
    this.tokenCounter.recordTokenUsage({ model: modelSel.model, provider: modelSel.provider, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, method: usage.method, estimated: usage.estimated });
    this.logger.info(`已完成: ${filename} 用量 in=${usage.inputTokens} out=${usage.outputTokens} total=${usage.totalTokens} (${usage.method === 'api_response' ? '真实' : '估算'})`);

    // 保存原始 JSON 文本（可能非严格JSON）
    const base = path.join(tempDir, path.basename(filename, path.extname(filename)));
    const rawJsonPath = `${base}_sample_0.json`;
    const repairedJsonPath = `${base}_sample_0_repaired.json`;
    const parsedJsonPath = `${base}_sample_0_parsed.json`;
    const csvPath = `${base}_sample_0.csv`;

    fs.writeFileSync(rawJsonPath, text, 'utf8');

    // 3) 解析与 Schema 校验
    let parsed = JsonUtils.safeParseJson(text);
    let json = parsed.ok ? parsed.data : null;
    let validation = json ? this.schemaValidator.validate(json) : { valid: false, errors: [{ path: '', message: 'JSON非法' }] };

    // 4) 纠错回合
    let attempt = 0;
    while ((!json || !validation.valid) && attempt < maxRepairAttempts) {
      attempt++;
      const errorsForLLM = (validation.errors || []).map((e) => `- ${e.path || 'root'}: ${e.message}`).join('\n');
      const repairPrompt = fs.existsSync(repairPath) ? fs.readFileSync(repairPath, 'utf8') : '修复上面的 JSON；仅返回修复后的 JSON。';
      const repairMessages = [
        { role: 'system', content: repairPrompt },
        { role: 'user', content: `原始JSON：\n${text}\n\n错误列表：\n${errorsForLLM}` }
      ];

      this.logger.info(`发送中(修复): ${filename} [${attempt}/${maxRepairAttempts}] -> ${modelSel.provider}/${modelSel.model}`);
      const { text: repairText, raw: repairRaw } = await this.client.chatCompletion({
        providerName: modelSel.provider,
        model: modelSel.model,
        messages: repairMessages,
        extra: { temperature: 0.0 },
        timeouts: {
          connectTimeoutMs: modelSel?.timeouts?.connectTimeoutMs ?? this.config.network?.connect_timeout_ms,
          responseTimeoutMs: modelSel?.timeouts?.responseTimeoutMs ?? this.config.network?.response_timeout_ms,
        }
      });
      const repairUsage = this.tokenCounter.getTokenUsage(repairRaw, errorsForLLM, repairText, modelSel.model);
      this.tokenCounter.recordTokenUsage({ model: modelSel.model, provider: modelSel.provider, inputTokens: repairUsage.inputTokens, outputTokens: repairUsage.outputTokens, method: repairUsage.method, estimated: repairUsage.estimated });
      this.logger.info(`已完成(修复): ${filename} 用量 in=${repairUsage.inputTokens} out=${repairUsage.outputTokens} total=${repairUsage.totalTokens} (${repairUsage.method === 'api_response' ? '真实' : '估算'})`);

      fs.writeFileSync(repairedJsonPath, repairText, 'utf8');
      parsed = JsonUtils.safeParseJson(repairText);
      json = parsed.ok ? parsed.data : null;
      validation = json ? this.schemaValidator.validate(json) : { valid: false, errors: [{ path: '', message: 'JSON非法' }] };
    }

    if (!json || !validation.valid) {
      throw new Error(`结构化解析/校验失败: ${validation.errors?.[0]?.message || '未知错误'}`);
    }

    // 5) JSON(rows) → CSV
    const csvText = this._rowsToCsv(json.rows || []);
    fs.writeFileSync(csvPath, csvText, 'utf8');
    // 保存规范化后的 JSON，便于后续检查
    try { fs.writeFileSync(parsedJsonPath, JSON.stringify({ rows: json.rows || [] }, null, 2), 'utf8'); } catch {}

    // 6) 进入现有 CSV 校验与（可选）多样本语义校验（此处单样本）
    const csvValidation = await this.csvValidator.validateAndFix(csvText, filename);
    const finalCsv = csvValidation.fixed;

    return { finalCsv, csvValidation, repairAttemptsUsed: attempt, validationErrors: validation.errors };
  }

  _rowsToCsv(rows) {
    const headers = ['编号', '问题', '答案', '答题人', '专业'];
    const normalize = (val) => {
      // CSV 单行记录内禁止换行符，将其替换为空格
      const s = (val == null ? '' : String(val)).replace(/\r\n|\r|\n/g, ' ');
      return s.replace(/\s+/g, ' ').trim();
    };
    const escape = (v) => {
      const s = normalize(v);
      const escaped = s.replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        escape(r['编号']),
        escape(r['问题']),
        escape(r['答案']),
        escape(r['答题人']),
        escape(r['专业'])
      ].join(','));
    }
    return lines.join('\n');
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _formatLocalTimestamp(timeZone = 'Asia/Shanghai') {
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
    }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}`;
  }
}

module.exports = StructuredFileProcessor;


