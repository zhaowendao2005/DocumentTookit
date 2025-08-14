const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const ConfigLoader = require('./config/config-loader');
const { runStartupDiagnostics } = require('./utils/diagnostics');
const fs = require('fs');
const path = require('path');
const InteractiveUI = require('./modules/ui-interactive');
const DocxToMdConverter = require('./tools/docx_to_md_converter');
const FileProcessor = require('./modules/file-processor');
const ModelTester = require('./modules/model-tester');
const CsvMerger = require('./utils/csv-merger');
const TextSplitterUI = require('./modules/text-splitter-ui');
const { RunController } = require('./utils/run-controller');

// 全局未捕获错误兜底（写入 app/data/logs/unhandled.log）
function setupGlobalErrorHandlers() {
    const appLogDir = path.join(process.cwd(), 'app', 'data', 'logs');
    try { fs.mkdirSync(appLogDir, { recursive: true }); } catch {}
    const logFile = path.join(appLogDir, 'unhandled.log');
    const write = (prefix, err) => {
        const msg = `[${new Date().toISOString()}] ${prefix}: ${err && err.stack ? err.stack : (err && err.message) || String(err)}\n`;
        try { fs.appendFileSync(logFile, msg, 'utf8'); } catch {}
        try { console.error(chalk.red(prefix + ':'), err && err.message ? err.message : err); } catch {}
    };
    process.on('uncaughtException', (err) => write('uncaughtException', err));
    process.on('unhandledRejection', (reason) => write('unhandledRejection', reason));
}

setupGlobalErrorHandlers();

const argv = process.argv.slice(2);
const flagDiag = argv.includes('--diag');
const flagDiagOnError = argv.includes('--diag-on-error');

if (flagDiag) {
    (async () => {
        await runStartupDiagnostics({ pingProvider: true, logToConsole: true });
        process.exit(0);
    })();
}

class MainApplication {
    constructor() {
        this.config = null;
        this.ui = null;
    }

    /**
     * 启动应用
     */
    async start() {
        try {
            // 先创建UI实例
            this.ui = new InteractiveUI();
            
            // 显示欢迎界面
            this.ui.showWelcome();
            
            // 加载配置
            await this.loadConfiguration();
            
            // 主循环
            await this.mainLoop();
            
        } catch (error) {
            this.ui.showError(`应用启动失败: ${error.message}`);
            process.exit(1);
        }
    }

    /**
     * 加载配置
     */
    async loadConfiguration() {
        try {
            this.ui.showProgress('正在加载配置...');
            this.config = await ConfigLoader.load();
            // 更新UI实例的配置
            this.ui.config = this.config;
            this.ui.stopProgress();
            this.ui.showSuccess('配置加载成功');
        } catch (error) {
            this.ui.stopProgress();
            this.ui.showError(`配置加载失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 主循环
     */
    async mainLoop() {
        while (true) {
            try {
                const action = await this.ui.showMainMenu();
                
                switch (action) {
                    case 'batch_llm':
                        await this.handleBatchLLM();
                        break;
                    case 'colipot':
                        await this.handleColipot();
                        break;
                        
                    case 'docx_to_md':
                        await this.handleDocxToMd();
                        break;
                        
                    case 'model_test':
                        await this.handleModelTest();
                        break;
                        
                    case 'csv_merge':
                        await this.handleCsvMerge();
                        break;
                
                case 'csv_clean':
                    await this.handleCsvClean();
                    break;
                        
                    case 'text_splitter':
                        await this.handleTextSplitter();
                        break;
                        
                    case 'config':
                        await this.handleConfig();
                        break;
                        
                    case 'status':
                        await this.ui.showSystemStatus(this.config);
                        break;
                        
                    case 'exit':
                        this.ui.showInfo('感谢使用，再见！');
                        process.exit(0);
                        break;
                        
                    default:
                        this.ui.showWarning('未知操作');
                }
                
                // 等待用户确认
                await this.ui.waitForUser();
                
            } catch (error) {
                this.ui.showError(`操作执行失败: ${error.message}`);
                await this.ui.waitForUser();
            }
        }
    }

    /**
     * 处理批量LLM处理
     */
    async handleBatchLLM() {
        try {
            const setup = await this.ui.interactiveSetup(this.config);
            
            if (!setup) {
                this.ui.showWarning('用户取消操作');
                return;
            }

            // 确保目录存在
            ConfigLoader.ensureDirectories(this.config);

            // 执行批量处理 / 或错误重处理
            const processor = new FileProcessor({ config: this.config, logger: console });
            this.ui.showInfo('开始批量处理...');
            // 注册停止热键（s）
            const controller = new RunController();
            try {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(true);
                    process.stdin.resume();
                    process.stdin.on('data', (buf) => {
                        const key = buf.toString().toLowerCase();
                        if (key === 's') {
                            if (!controller.isStopped()) {
                                controller.softStop('user pressed s (soft)');
                                this.ui.showWarning('收到停止指令(软)：不再启动新请求，等待已在途的请求返回；未开始的将标记 user_cancelled');
                            } else if (!controller.isHardStopped()) {
                                controller.hardStop('user pressed s (hard)');
                                this.ui.showWarning('收到停止指令(硬)：立即结束在途请求，已在途的将标记 user_cancelled');
                            }
                        } else if (key === '\u0003') { // Ctrl+C
                            controller.hardStop('SIGINT');
                            this.ui.showWarning('收到 Ctrl+C（硬停止），停止当前任务');
                        }
                    });
                    this.ui.showInfo('按 s 停止当前任务');
                }
            } catch (_) {}
            let result;
            const mode = setup.mode || (this.config.processing?.default_mode || 'classic');
            // 错误重处理模式：复用原 run 输出目录
            const reprocess = setup.reprocess && setup.reprocess.enable;
            let extraOptions = {};
            if (reprocess && setup.reprocess.errorDir) {
                const path = require('path');
                const fs = require('fs');
                const errorDir = setup.reprocess.errorDir;
                const runOutputDir = path.dirname(errorDir); // .../<runId>
                const fixedRunId = path.basename(runOutputDir);
                extraOptions = { reuseRunOutputDir: true, fixedRunOutputDir: runOutputDir, fixedRunId };
                // 将 inputs 切换为错误目录下“受支持类型”的文件集合（排除所有 .json）
                const SUPPORTED_EXTS = new Set(['.md', '.txt', '.docx']);
                const collectFiles = (dir) => {
                    const list = [];
                    const walk = (d) => {
                        const items = fs.readdirSync(d);
                        for (const it of items) {
                            const p = path.join(d, it);
                            const st = fs.statSync(p);
                            if (st.isDirectory()) {
                                walk(p);
                            } else {
                                const ext = path.extname(p).toLowerCase();
                                if (SUPPORTED_EXTS.has(ext)) list.push(p);
                            }
                        }
                    };
                    walk(dir);
                    return list;
                };
                const reInputs = collectFiles(errorDir);
                setup.inputs = reInputs;
                setup.outputDir = path.dirname(runOutputDir); // 传入父 output，以便处理器内部拼回 fixedRunOutputDir
                this.ui.showInfo(`错误重处理：从 ${errorDir} 收集 ${reInputs.length} 个文件，结果将回写 ${runOutputDir}`);
            }
            if (mode === 'structured') {
                const StructuredFileProcessor = require('./modules/structured-file-processor');
                const sproc = new StructuredFileProcessor({ config: this.config, logger: console });
                this.ui.showInfo('以结构化模式处理...');
                result = await sproc.runBatch(
                    { ...setup.model, timeouts: setup.timeouts, validation: setup.validation },
                    setup.inputs,
                    setup.outputDir,
                    { promptVersion: setup?.structured?.promptVersion, repairAttempts: setup?.structured?.repairAttempts, controller, ...extraOptions }
                );

                // 生成运行总结报告（md + json）
                try {
                    const RunSummary = require('./modules/run-summary');
                    const TokenCounter = require('./utils/token-counter');
                    const summary = new RunSummary({ logger: console });
                    const tc = new TokenCounter();
                    // 直接读取当前内存统计不可得，这里仅读取日志不可行；简化为跳过详细token统计或由处理器返回汇总
                    const json = summary.generateSummaryJson({
                        runId: result.runId,
                        runOutputDir: result.runOutputDir,
                        mode: 'structured',
                        stats: result,
                        tokenStats: result.tokenStats || null
                    });
                    summary.writeJson(json, result.runOutputDir);
                    summary.writeMarkdown(json, result.runOutputDir);
                } catch (e) {
                    this.ui.showWarning('生成运行总结失败：' + e.message);
                }

                // 可选：让LLM基于运行JSON生成自然语言总结
                if (setup.llmSummary?.enabled) {
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const jsonPath = path.join(result.runOutputDir, 'run_summary.json');
                        if (fs.existsSync(jsonPath)) {
                            const LLMClient = require('./modules/llm-client');
                            const client = new LLMClient({ providers: this.config.providers, retry: this.config.retry });
                            const jsonText = fs.readFileSync(jsonPath, 'utf8');
                            const messages = [
                                { role: 'system', content: '你是报告总结助手。基于给定的运行JSON数据，用中文生成清晰、结构化的运行总结（包含总览、模式占比、失败原因Top、Token用量如有、逐文件简表），仅输出Markdown。' },
                                { role: 'user', content: jsonText }
                            ];
                            const resp = await client.chatCompletion({
                                providerName: setup.llmSummary.model.provider,
                                model: setup.llmSummary.model.model,
                                messages,
                                extra: { temperature: 0.1 },
                                timeouts: { connectTimeoutMs: setup.timeouts.connectTimeoutMs, responseTimeoutMs: setup.timeouts.responseTimeoutMs }
                            });
                            const md = resp.text || '';
                            fs.writeFileSync(path.join(result.runOutputDir, 'run_summary_llm.md'), md, 'utf8');
                            this.ui.showInfo('已生成 LLM 运行总结: run_summary_llm.md');
                        }
                    } catch (e) {
                        this.ui.showWarning('LLM 运行总结失败：' + e.message);
                    }
                }
            } else {
                result = await processor.runBatch(
                    { ...setup.model, timeouts: setup.timeouts, validation: setup.validation },
                    setup.inputs,
                    setup.outputDir,
                    { controller, ...extraOptions }
                );
                // 经典模式同样生成运行总结
                try {
                    const RunSummary = require('./modules/run-summary');
                    const summary = new RunSummary({ logger: console });
                    const json = summary.generateSummaryJson({
                        runId: result.runId,
                        runOutputDir: result.runOutputDir,
                        mode: 'classic',
                        stats: result,
                        tokenStats: result.tokenStats || null
                    });
                    summary.writeJson(json, result.runOutputDir);
                    summary.writeMarkdown(json, result.runOutputDir);
                } catch (e) {
                    this.ui.showWarning('生成运行总结失败：' + e.message);
                }
            }

            // 重处理结果清理（删除 error 下已修复文件并更新清单）
            if (reprocess && setup.reprocess.errorDir) {
                try {
                    const { applyCleanup } = require('./utils/error-cleanup');
                    await applyCleanup({
                        runOutputDir: extraOptions.fixedRunOutputDir,
                        errorDir: setup.reprocess.errorDir,
                        result,
                        logger: this.ui,
                        options: this.config.errors?.cleanup || {},
                    });
                } catch (e) {
                    this.ui.showWarning(`清理错误目录失败：${e.message}`);
                }
            }

            this.ui.showSuccess(`处理完成：总数=${result.total} 成功=${result.succeeded} 失败=${result.failed}`);

            // 收尾后处理：询问是否插入元数据行（已在写出阶段应用开关）、是否自动清洗合并、是否导出为XLSX
            try {
                const inquirer = require('inquirer');
                const answers = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'autoCleanMerge',
                        message: chalk.cyan('是否对本次产物自动执行“清洗并合并”？'),
                        default: this.config?.post_run?.auto_clean_merge === 'always'
                    },
                    {
                        type: 'confirm',
                        name: 'addMetadataRow',
                        message: chalk.cyan('是否在单文件CSV与合并产物中启用“元数据行”？'),
                        default: (typeof this.config?.output?.add_metadata_row === 'boolean') ? this.config.output.add_metadata_row : true
                    },
                    {
                        type: 'confirm',
                        name: 'exportXlsx',
                        message: chalk.cyan('是否将合并结果导出为 Excel(xlsx)？'),
                        default: false
                    },
                    {
                        type: 'confirm',
                        name: 'treatCommonNull',
                        message: chalk.cyan('清洗时是否将 NULL/N-A/— 等也视为空？'),
                        default: !!this.config?.post_run?.clean?.treat_common_null,
                        when: (a) => a.autoCleanMerge
                    }
                ]);

                if (answers.autoCleanMerge) {
                    const cleanedDir = path.join(result.runOutputDir, this.config?.post_run?.clean?.output_subdir || 'cleaned');
                    const { runOnce } = require('./tools/csv-cleaner');
                    await runOnce({ target: result.runOutputDir, outputDir: cleanedDir, treatCommonNull: answers.treatCommonNull });

                    const merger = new CsvMerger();
                    let csvFiles = await merger.findCsvFiles(cleanedDir);

                    // 基于顺序清单进行排序与缺失容忍
                    try {
                        const manifestPath = path.join(result.runOutputDir, 'inputs_order.json');
                        if (fs.existsSync(manifestPath)) {
                            const orderList = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                            const toCleanedPath = (rel) => {
                                const relDir = path.dirname(rel);
                                const base = path.basename(rel, path.extname(rel));
                                return path.join(cleanedDir, relDir, `${base}.cleaned.csv`);
                            };
                            const ordered = [];
                            const missing = [];
                            for (const rel of orderList) {
                                const p = toCleanedPath(rel);
                                if (fs.existsSync(p)) ordered.push(p); else missing.push(rel);
                            }
                            if (ordered.length > 0) {
                                csvFiles = ordered;
                            }
                            if (missing.length > 0) {
                                this.ui.showWarning(`顺序清单中有 ${missing.length} 个文件在清洗产物中缺失，已跳过`);
                            }
                        } else {
                            this.ui.showWarning('未发现 inputs_order.json，合并顺序按文件系统遍历，可能与输入顺序不一致');
                        }
                    } catch (e) {
                        this.ui.showWarning(`应用顺序清单失败：${e.message}`);
                    }

                    const nameVerbatim = this.config?.post_run?.merge?.output_name_csv_verbatim || 'merged_verbatim.csv';
                    const nameNoMeta = this.config?.post_run?.merge?.output_name_csv_no_meta || 'merged_no_meta.csv';
                    const xlsxName = this.config?.post_run?.merge?.output_name_xlsx || 'merged.xlsx';

                    const outVerbatim = path.join(cleanedDir, nameVerbatim);
                    const outNoMeta = path.join(cleanedDir, nameNoMeta);
                    const outXlsx = path.join(cleanedDir, xlsxName);

                    const insertBlank = this.config?.post_run?.merge?.insert_blank_line_between_blocks !== false;
                    const marker = this.config?.output?.metadata_marker || '[META]';

                    const rowsVerbatim = await merger.concatCsvFilesVerbatim(csvFiles, { insertBlankLineBetweenBlocks: insertBlank });
                    const rowsNoMeta = await merger.concatCsvFilesNoMeta(csvFiles, { insertBlankLineBetweenBlocks: insertBlank, marker });

                    await merger.writeMergedCsv(rowsVerbatim, outVerbatim);
                    await merger.writeMergedCsv(rowsNoMeta, outNoMeta);

                    if (answers.exportXlsx) {
                        await merger.exportXlsx({ withMetaRows: rowsVerbatim, noMetaRows: rowsNoMeta, xlsxPath: outXlsx, sheet1: '含元数据', sheet2: '无元数据' });
                    }
                }
            } catch (e) {
                this.ui.showWarning('后处理失败：' + e.message);
            }
            try {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
            } catch (_) {}
            
        } catch (error) {
            this.ui.showError(`批量LLM处理失败: ${error.message}`);
        }
    }

    /**
     * 处理 Colipot 预置方案批量运行
     */
    async handleColipot() {
        try {
            // 选择方案
            const setup = await this.ui.colipotSetup(this.config);
            if (!setup) {
                this.ui.showWarning('未选择方案或已取消');
                return;
            }

            // 确保目录存在
            const ConfigLoader = require('./config/config-loader');
            ConfigLoader.ensureDirectories(this.config);

            // 执行批量处理（按模式）
            const mode = setup.mode || (this.config.processing?.default_mode || 'classic');
            let result;
            if (mode === 'structured') {
                const StructuredFileProcessor = require('./modules/structured-file-processor');
                const sproc = new StructuredFileProcessor({ config: this.config, logger: console });
                this.ui.showInfo('以结构化模式处理 (Colipot 方案)...');
                result = await sproc.runBatch(
                    { ...setup.model, timeouts: setup.timeouts, validation: setup.validation },
                    setup.inputs,
                    setup.outputDir,
                    { promptVersion: setup?.structured?.promptVersion, repairAttempts: setup?.structured?.repairAttempts }
                );

                // 生成运行总结报告
                try {
                    const RunSummary = require('./modules/run-summary');
                    const summary = new RunSummary({ logger: console });
                    const json = summary.generateSummaryJson({
                        runId: result.runId,
                        runOutputDir: result.runOutputDir,
                        mode: 'structured',
                        stats: result,
                        tokenStats: result.tokenStats || null
                    });
                    summary.writeJson(json, result.runOutputDir);
                    summary.writeMarkdown(json, result.runOutputDir);
                } catch (e) {
                    this.ui.showWarning('生成运行总结失败：' + e.message);
                }
            } else {
                const FileProcessor = require('./modules/file-processor');
                const processor = new FileProcessor({ config: this.config, logger: console });
                this.ui.showInfo('以经典模式处理 (Colipot 方案)...');
                result = await processor.runBatch(
                    { ...setup.model, timeouts: setup.timeouts, validation: setup.validation },
                    setup.inputs,
                    setup.outputDir
                );
                try {
                    const RunSummary = require('./modules/run-summary');
                    const summary = new RunSummary({ logger: console });
                    const json = summary.generateSummaryJson({
                        runId: result.runId,
                        runOutputDir: result.runOutputDir,
                        mode: 'classic',
                        stats: result,
                        tokenStats: result.tokenStats || null
                    });
                    summary.writeJson(json, result.runOutputDir);
                    summary.writeMarkdown(json, result.runOutputDir);
                } catch (e) {
                    this.ui.showWarning('生成运行总结失败：' + e.message);
                }
            }

            this.ui.showSuccess(`处理完成：总数=${result.total} 成功=${result.succeeded} 失败=${result.failed}`);
        } catch (error) {
            this.ui.showError(`Colipot 批量处理失败: ${error.message}`);
        }
    }

    /**
     * 处理Docx转Md转换
     */
    async handleDocxToMd() {
        try {
            const config = await this.ui.configureDocxToMd();
            
            if (!config) {
                this.ui.showWarning('用户取消操作');
                return;
            }

            this.ui.showInfo('开始Docx转Markdown转换...');
            
            // 使用现有的转换器
            const converter = new DocxToMdConverter();
            const success = converter.convert(config.inputDir, config.outputDir);
            
            if (success) {
                this.ui.showSuccess('转换完成！');
            } else {
                this.ui.showWarning('转换过程中出现错误，请查看上方日志');
            }
            
        } catch (error) {
            this.ui.showError(`Docx转Md转换失败: ${error.message}`);
        }
    }

    /**
     * 处理模型测试
     */
    async handleModelTest() {
        try {
            const testConfig = await this.ui.configureModelTest(this.config);
            
            if (!testConfig) {
                this.ui.showWarning('用户取消操作');
                return;
            }

            // 执行模型测试
            const tester = new ModelTester(this.config);
            const results = await tester.runTest(testConfig);
            
            if (results && results.length > 0) {
                // 询问是否导出测试报告
                const exportReport = await this.ui.confirmAction('是否导出测试报告到JSON文件？', false);
                if (exportReport) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const reportPath = `./output/model_test_report_${timestamp}.json`;
                    tester.exportTestReport(results, reportPath);
                }
            }
            
        } catch (error) {
            this.ui.showError(`模型测试失败: ${error.message}`);
        }
    }

    async handleCsvMerge() {
        try {
            const mergeConfig = await this.ui.configureCsvMerge(this.config);
            
            if (!mergeConfig) {
                this.ui.showWarning('用户取消操作');
                return;
            }

            // 执行CSV合并
            const merger = new CsvMerger();
            const success = await merger.mergeCsvFilesInteractive(
                mergeConfig.inputDir, 
                mergeConfig.outputDir
            );
            
            if (success) {
                this.ui.showSuccess('CSV合并完成');
            } else {
                this.ui.showWarning('CSV合并未完成或失败');
            }
            
        } catch (error) {
            this.ui.showError(`CSV合并失败: ${error.message}`);
        }
    }

    async handleCsvClean() {
        try {
            const config = await this.ui.configureCsvClean(this.config);
            if (!config) {
                this.ui.showWarning('用户取消操作');
                return;
            }
            const { runOnce } = require('./tools/csv-cleaner');
            await runOnce({ target: config.target, outputDir: config.outputDir, treatCommonNull: config.treatCommonNull });
            this.ui.showSuccess('CSV清洗完成');
        } catch (error) {
            this.ui.showError(`CSV清洗失败: ${error.message}`);
        }
    }

    /**
     * 处理文本分割工具
     */
    async handleTextSplitter() {
        try {
            const textSplitterUI = new TextSplitterUI(this.config);
            await textSplitterUI.run();
        } catch (error) {
            this.ui.showError(`文本分割工具执行失败: ${error.message}`);
        }
    }

    /**
     * 处理配置管理
     */
    async handleConfig() {
        try {
            while (true) {
                const action = await this.ui.showConfigMenu(this.config);
                
                switch (action) {
                    case 'view':
                        await this.ui.showSystemStatus(this.config);
                        break;
                        
                    case 'edit':
                        this.ui.showInfo('请手动编辑 config/env.yaml 文件');
                        break;
                        
                    case 'reload':
                        await this.loadConfiguration();
                        break;
                        
                    case 'back':
                        return;
                        
                    default:
                        this.ui.showWarning('未知操作');
                }
            }
        } catch (error) {
            this.ui.showError(`配置管理失败: ${error.message}`);
        }
    }
}

// 启动应用
async function main() {
    const app = new MainApplication();
    await app.start();
}

// 如果直接运行此脚本，则执行主函数
if (require.main === module) {
    main().catch(async (error) => {
        console.error(chalk.red('❌ 程序执行失败:'), error.message);
        if (flagDiagOnError) {
            try { await runStartupDiagnostics({ pingProvider: true, logToConsole: true }); } catch {}
        }
        process.exit(1);
    });
}

module.exports = MainApplication;