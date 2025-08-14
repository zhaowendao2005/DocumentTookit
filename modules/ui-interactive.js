const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const gradient = require('gradient-string');
const FileSelector = require('../utils/file-selector');

class InteractiveUI {
    constructor(config = {}) {
        this.spinner = null;
        this.config = config;
        this.fileSelector = new FileSelector();
    }

  /**
   * 列出结构化 prompts 版本目录
   */
  listPromptVersions(rootDir) {
    try {
      if (!fs.existsSync(rootDir)) return [];
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (_) {
      return [];
    }
  }

    /**
     * 显示欢迎界面
     */
    showWelcome() {
        const welcomeText = boxen(
            gradient.pastel.multiline([
                '🚀 批量LLM处理工具',
                'Batch LLM Processor',
                '',
                '支持多提供商、错配检测、语义相似度验证'
            ].join('\n')),
            {
                padding: 1,
                margin: 1,
                borderStyle: 'round',
                borderColor: 'cyan'
            }
        );
        
        console.clear();
        console.log(welcomeText);
        console.log('');
    }

    /**
     * 显示主菜单
     */
    async showMainMenu() {
        const choices = [
            {
                name: '🔄 批量LLM处理',
                value: 'batch_llm',
                description: '使用LLM批量处理文件，支持错配检测'
            },
            {
                name: '📄 Word转Markdown',
                value: 'docx_to_md',
                description: '批量将Word文档(doc/docx)转换为markdown文件'
            },
            {
                name: '🧪 模型测试',
                value: 'model_test',
                description: '测试LLM模型的可用性和响应质量'
            },
            {
                name: '📊 CSV合并工具',
                value: 'csv_merge',
                description: '合并多个CSV文件为一个文件'
            },
            {
                name: '🧼 CSV清洗工具',
                value: 'csv_clean',
                description: '删除第三列为空的行，逐文件输出'
            },
            {
                name: '✂️  文本分割工具',
                value: 'text_splitter',
                description: '使用正则表达式进行多级文本分割'
            },
      {
        name: '🧩 Colipot 预置方案',
        value: 'colipot',
        description: '从 config/ColipotConfig/*.yaml 选择一份预置方案一键运行'
      },
            {
                name: '⚙️  配置管理',
                value: 'config',
                description: '管理LLM提供商和系统配置'
            },
            {
                name: '📊 查看状态',
                value: 'status',
                description: '查看系统状态和配置信息'
            },
            {
                name: '❌ 退出',
                value: 'exit'
            }
        ];

        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: '请选择要执行的操作:',
            choices: choices,
            pageSize: 10
        }]);

        return answer.action;
    }

    /**
     * 交互式设置 - 批量LLM处理
     */
    async interactiveSetup(config) {
        console.log(chalk.cyan('\n🔄 配置批量LLM处理...\n'));

        // 1. 选择模型
        const modelSelection = await this.selectModel(config.providers);
        
    // 1.1 选择输出模式（Classic / Structured）
    const modeAnswer = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: chalk.cyan('选择输出模式:'),
      choices: [
        { name: 'Classic - 直接输出CSV', value: 'classic' },
        { name: 'Structured - 输出rows JSON→本地转CSV', value: 'structured' }
      ],
      default: (config.processing?.default_mode || 'classic')
    }]);

        // 2. 选择输入（支持目录树选择与多选，含“错误重处理批次”）
        const inputSel = await this.selectInputs(config.directories.input_dir);
        let inputs = Array.isArray(inputSel) ? inputSel : (inputSel.inputs || []);
        let isReprocess = !Array.isArray(inputSel) && inputSel && inputSel.mode === 'reprocess';
        let reprocessInfo = isReprocess ? (inputSel.reprocess || null) : null;

        // 3. 选择输出目录（重处理模式跳过，由主流程回写原 runId 目录）
        let outputDir;
        if (!isReprocess) {
          outputDir = await this.selectPath('输出目录', config.directories.output_dir);
        } else {
          outputDir = config.directories.output_dir; // 占位，不实际使用
          console.log(chalk.yellow(`本次为错误重处理，将回写原运行目录：${reprocessInfo?.runId || '(未知运行ID)'}`));
        }
        
        // 4. 显示文件数量
        const fileCount = await this.countFilesInTargets(inputs);
        console.log(chalk.green(`\n✅ 发现 ${fileCount} 个待处理文件`));
        
        // 5. 配置校验
        const validationConfig = await this.configureValidation(config.validation);

        // 6. 覆盖时间参数
        const timeoutConfig = await this.configureTimeouts(config.network || {});

    // 7. 若为 Structured，选择提示词版本与修复回合
    let structured = null;
    if (modeAnswer.mode === 'structured') {
      const promptsRoot = config.structured?.prompts_root || './prompts/StructuredFileProcessor';
      const versions = this.listPromptVersions(promptsRoot);
      const versionAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'promptVersion',
        message: chalk.cyan('选择提示词版本:'),
        choices: versions.length ? versions : ['v1.0'],
        default: config.structured?.default_prompt_version || 'v1.0'
      }]);
      const repairAnswer = await inquirer.prompt([{
        type: 'number',
        name: 'repairAttempts',
        message: chalk.cyan('JSON纠错回合上限(0-3):'),
        default: config.structured?.max_repair_attempts ?? 2,
        validate: (n) => (n >= 0 && n <= 3) ? true : chalk.red('范围 0-3')
      }]);
      structured = {
        mode: 'structured',
        promptVersion: versionAnswer.promptVersion,
        repairAttempts: repairAnswer.repairAttempts
      };
    }
    

    // 8. 可选：让 LLM 在任务结束后根据 JSON 生成总结报告（单独选择模型）
    const wantLLMSummary = await inquirer.prompt([{
      type: 'confirm',
      name: 'enableLLMSummary',
      message: chalk.cyan('任务结束后是否让LLM生成总结报告（基于运行JSON）？'),
      default: false
    }]);
    let llmSummaryModel = null;
    if (wantLLMSummary.enableLLMSummary) {
      const modelSel = await this.selectModel(config.providers);
      llmSummaryModel = modelSel;
    }

    // 9. 错误重处理模式在“选择输入源”中完成，无需二次确认

        return {
            model: modelSelection,
            inputs: inputs,
            outputDir: outputDir,
            fileCount: fileCount,
            validation: validationConfig,
            timeouts: timeoutConfig,
            mode: modeAnswer.mode,
            structured: structured,
            llmSummary: {
              enabled: wantLLMSummary.enableLLMSummary,
              model: llmSummaryModel
            },
            reprocess: reprocessInfo
        };
    }

    /**
     * 扫描输出根目录，按时间戳倒序列出包含 error 的运行目录
     * @param {string} outputRoot
     * @returns {Array<{ runId:string, errorDir:string, summary?:object, manifest?:object, errorStats?:object, failed?:number, total?:number }>}
     */
    listErrorReprocessCandidates(outputRoot) {
      try {
        if (!fs.existsSync(outputRoot)) return [];
        const entries = fs.readdirSync(outputRoot, { withFileTypes: true });
        const tsRegex = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
        const candidates = [];
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const name = ent.name;
          if (!tsRegex.test(name)) continue;
          const runDir = path.join(outputRoot, name);
          const errDir = path.join(runDir, 'error');
          if (!fs.existsSync(errDir)) continue;

          let summary = null;
          let manifest = null;
          let errorStats = null;
          let total = undefined;
          let failed = undefined;

          const summaryPath = path.join(runDir, 'run_summary.json');
          if (fs.existsSync(summaryPath)) {
            try {
              summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
              const t = summary.totals || summary.totals || null;
              if (t) {
                total = t.total;
                failed = t.failed;
              }
              errorStats = summary.errorStats || null;
            } catch (_) {}
          }

          const manifestPath = path.join(errDir, 'error_manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              errorStats = errorStats || manifest.byType || null;
              failed = failed ?? manifest.total;
            } catch (_) {}
          }

          // 回退：粗略统计 error 目录内文件数量
          if (failed == null || errorStats == null) {
            try {
              const types = fs.readdirSync(errDir, { withFileTypes: true }).filter(d => d.isDirectory());
              const counts = {};
              let fsum = 0;
              for (const d of types) {
                const typeDir = path.join(errDir, d.name);
                const files = this._countFilesRecursive(typeDir, (p) => !p.endsWith('error.json'));
                counts[d.name] = files;
                fsum += files;
              }
              errorStats = errorStats || counts;
              failed = failed ?? fsum;
            } catch (_) {}
          }

          // 空 error 目录跳过
          if (!failed || failed <= 0) continue;

          candidates.push({ runId: name, errorDir: errDir, summary, manifest, errorStats, total, failed });
        }
        // 倒序（最新在前）
        candidates.sort((a, b) => (a.runId < b.runId ? 1 : -1));
        return candidates;
      } catch (_) {
        return [];
      }
    }

    _countFilesRecursive(dir, accept = () => true) {
      let count = 0;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const it of items) {
          const p = path.join(dir, it.name);
          if (it.isDirectory()) count += this._countFilesRecursive(p, accept);
          else if (accept(p)) count += 1;
        }
      } catch (_) {}
      return count;
    }

    /**
     * 让用户选择一个错误重处理候选项（最新优先），或手动选择
     * @param {string} outputRoot
     * @returns {Promise<{ type:'candidate'|'manual'|'back', runId?:string, errorDir?:string }|null>}
     */
    async selectErrorReprocessCandidate(outputRoot) {
      const cands = this.listErrorReprocessCandidates(outputRoot);
      const choices = [];
      for (const c of cands) {
        const stats = c.errorStats || {};
        const statStr = Object.keys(stats).map(k => `${k}:${stats[k]}`).join(' ');
        const totalStr = (c.total != null) ? ` 总数:${c.total}` : '';
        choices.push({
          name: `${c.runId}  失败:${c.failed}${totalStr}  [${statStr}]`,
          value: { type: 'candidate', runId: c.runId, errorDir: c.errorDir },
          short: c.runId,
        });
      }
      choices.push(new inquirer.Separator());
      choices.push({ name: '手动选择错误目录…', value: { type: 'manual' } });
      choices.push({ name: '返回', value: { type: 'back' } });

      const ans = await inquirer.prompt([{
        type: 'list',
        name: 'sel',
        message: chalk.cyan('选择一个错误重处理批次（按时间倒序）：'),
        choices,
        pageSize: Math.min(12, Math.max(6, choices.length)),
        default: choices.length > 2 ? choices[0].value : undefined,
      }]);
      return ans.sel || null;
    }

    /**
     * Colipot 模式：选择方案并返回标准化配置
     */
    async colipotSetup(config) {
        const PlanRegistry = require('./colipot/plan-registry');
        const PlanInjector = require('./colipot/plan-injector');
        const registry = new PlanRegistry();
        const plans = registry.getAll();

        if (!plans || plans.length === 0) {
            console.log(chalk.yellow('\n⚠️  未在 config/ColipotConfig/ 下找到任何方案 (YAML)。'));
            return null;
        }

        const choices = plans.map((p) => ({
            name: `${p.display_name || p.name}  (${p.model.provider}/${p.model.model})`,
            value: p.name,
            short: p.name,
        }));

        const sel = await require('inquirer').prompt([
            {
                type: 'list',
                name: 'plan',
                message: chalk.cyan('选择一个 Colipot 方案:'),
                choices,
                pageSize: 12,
            },
        ]);

        const plan = registry.getByName(sel.plan);
        if (!plan) return null;

        // 显示摘要
        console.log(chalk.cyan('\n📄 方案摘要'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`名称: ${plan.display_name || plan.name}`);
        console.log(`模型: ${plan.model.provider} / ${plan.model.model}`);
        console.log(`模式: ${plan.processing?.mode || (config.processing?.default_mode || 'classic')}`);
        console.log(`输入: ${(plan.paths?.inputs || []).join(', ')}`);
        console.log(`输出: ${plan.paths?.output_dir}`);
        if (plan.validation) {
            console.log(`校验: enable=${!!plan.validation.enable_multiple_requests} count=${plan.validation.request_count ?? '-'} thr=${plan.validation.similarity_threshold ?? '-'}`);
        }
        if (plan.structured) {
            console.log(`结构化: version=${plan.structured.prompt_version ?? '-'} repair=${plan.structured.repair_attempts ?? '-'}`);
        }
        console.log(chalk.gray('─'.repeat(60)));

        const go = await require('inquirer').prompt([
            { type: 'confirm', name: 'confirm', message: chalk.yellow('确认按该方案直接运行？'), default: true },
        ]);
        if (!go.confirm) return null;

        // 映射为现有 runBatch 入参
        const mapped = PlanInjector.mapToRunBatchArgs(plan, config);

        // 返回与 interactiveSetup 结构相兼容的对象
        const ret = {
            model: mapped.modelSel,
            inputs: mapped.inputs,
            outputDir: mapped.outputDir,
            fileCount: await this.countFilesInTargets(mapped.inputs),
            validation: mapped.modelSel.validation,
            timeouts: mapped.modelSel.timeouts,
            mode: mapped.mode,
            structured: mapped.mode === 'structured' ? { promptVersion: mapped.options?.promptVersion, repairAttempts: mapped.options?.repairAttempts } : null,
            llmSummary: { enabled: false, model: null },
        };
        return ret;
    }

    /**
     * 选择LLM模型
     */
    async selectModel(providers) {
        const choices = [];
        
        providers.forEach(provider => {
            provider.models.forEach(model => {
                choices.push({
                    name: `${chalk.blue(provider.name)} - ${chalk.yellow(model)}`,
                    value: { provider: provider.name, model: model },
                    short: `${provider.name} - ${model}`
                });
            });
        });

        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'model',
            message: chalk.cyan('请选择LLM模型:'),
            choices: choices,
            pageSize: 15
        }]);

        return answer.model;
    }

    /**
     * 统一路径选择方法：首选图形文件选择器，支持手动输入备选
     * @param {string} title - 选择提示标题
     * @param {string} defaultPath - 默认路径
     * @param {Object} options - 选择选项
     * @param {boolean} options.selectFiles - 是否选择文件（默认选择目录）
     * @param {boolean} options.multiple - 是否支持多选（仅对文件有效）
     * @returns {Promise<string|string[]>} 选择的路径
     */
    async selectPath(title, defaultPath = './', options = {}) {
        const {
            selectFiles = false,
            multiple = false
        } = options;

        console.log(chalk.cyan(`\n📁 ${title}`));
        
        const methodChoice = await inquirer.prompt([{
            type: 'list',
            name: 'method',
            message: chalk.cyan('请选择路径输入方式:'),
            choices: [
                {
                    name: '🖱️  图形界面选择（推荐）',
                    value: 'gui',
                    short: '图形界面'
                },
                {
                    name: '⌨️  手动输入路径',
                    value: 'manual',
                    short: '手动输入'
                }
            ],
            default: 'gui'
        }]);

        if (methodChoice.method === 'gui') {
            try {
                return await this.selectPathGui(title, defaultPath, { selectFiles, multiple });
            } catch (error) {
                console.log(chalk.yellow('⚠️  图形选择失败，自动切换到手动输入模式'));
                return await this.selectPathManual(title, defaultPath, { selectFiles, multiple });
            }
        } else {
            return await this.selectPathManual(title, defaultPath, { selectFiles, multiple });
        }
    }

    /**
     * 图形界面路径选择
     */
    async selectPathGui(title, defaultPath, options = {}) {
        const { selectFiles = false, multiple = false } = options;
        
        const startPath = fs.existsSync(defaultPath) ? defaultPath : process.cwd();
        
        try {
            if (selectFiles) {
                // 选择文件
                const supportedExtensions = ['.txt', '.md', '.docx'];
                const result = await this.fileSelector.select({
                    type: 'file',
                    multiple: multiple,
                    startPath: startPath,
                    message: chalk.cyan(`${title} - 选择${multiple ? '文件（可多选）' : '文件'}`),
                    extensions: supportedExtensions
                });
                
                return result;
            } else {
                // 选择目录
                const result = await this.fileSelector.select({
                    type: 'directory',
                    multiple: false,
                    startPath: startPath,
                    message: chalk.cyan(`${title} - 选择目录`)
                });
                
                return result;
            }
        } catch (error) {
            throw new Error(`文件选择失败: ${error.message}`);
        }
    }

    /**
     * 手动输入路径
     */
    async selectPathManual(title, defaultPath, options = {}) {
        const { selectFiles = false, multiple = false } = options;
        
        if (multiple) {
            // 多路径输入（用逗号分隔）
            const answer = await inquirer.prompt([{
                type: 'input',
                name: 'paths',
                message: chalk.cyan(`${title}（多个路径用逗号分隔）:`),
                default: defaultPath,
                validate: (input) => {
                    if (!input || input.trim() === '') {
                        return chalk.red('请输入至少一个路径');
                    }
                    
                    const paths = input.split(',').map(p => p.trim()).filter(p => p);
                    for (const p of paths) {
                        if (!fs.existsSync(p)) {
                            return chalk.red(`路径不存在: ${p}`);
                        }
                        if (selectFiles && !fs.statSync(p).isFile()) {
                            return chalk.red(`不是文件: ${p}`);
                        }
                        if (!selectFiles && !fs.statSync(p).isDirectory()) {
                            return chalk.red(`不是目录: ${p}`);
                        }
                    }
                    return true;
                }
            }]);
            
            return answer.paths.split(',').map(p => p.trim()).filter(p => p);
        } else {
            // 单路径输入
            const answer = await inquirer.prompt([{
                type: 'input',
                name: 'path',
                message: chalk.cyan(`${title}:`),
                default: defaultPath,
                validate: (input) => {
                    if (!input || input.trim() === '') {
                        return chalk.red('请输入路径');
                    }
                    if (!fs.existsSync(input)) {
                        return chalk.red('路径不存在，请重新输入');
                    }
                    if (selectFiles && !fs.statSync(input).isFile()) {
                        return chalk.red('请输入文件路径');
                    }
                    if (!selectFiles && !fs.statSync(input).isDirectory()) {
                        return chalk.red('请输入目录路径');
                    }
                    return true;
                }
            }]);
            
            return answer.path;
        }
    }

    /**
     * 选择目录（兼容旧接口）
     */
    async selectDirectory(title, defaultPath) {
        return await this.selectPath(title, defaultPath, { selectFiles: false });
    }

    /**
     * 配置校验参数
     */
    async configureValidation(defaultConfig) {
        const answer = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'enableMultiple',
                message: chalk.cyan('是否启用多次发送校验？'),
                default: defaultConfig.enable_multiple_requests
            },
            {
                type: 'number',
                name: 'requestCount',
                message: chalk.cyan('每个文件发送次数:'),
                default: defaultConfig.request_count,
                when: (answers) => answers.enableMultiple,
                validate: (input) => {
                    if (input < 2 || input > 5) {
                        return chalk.red('发送次数必须在2-5之间');
                    }
                    return true;
                }
            },
            {
                type: 'number',
                name: 'similarityThreshold',
                message: chalk.cyan('相似度阈值 (0.0-1.0):'),
                default: defaultConfig.similarity_threshold,
                when: (answers) => answers.enableMultiple,
                validate: (input) => {
                    if (input < 0 || input > 1) {
                        return chalk.red('相似度阈值必须在0.0-1.0之间');
                    }
                    return true;
                }
            }
        ]);

        return {
            enableMultiple: answer.enableMultiple,
            requestCount: answer.requestCount || 1,
            similarityThreshold: answer.similarityThreshold || defaultConfig.similarity_threshold
        };
    }

    /**
     * 配置Word转Md转换
     */
    async configureDocxToMd() {
        console.log(chalk.cyan('\n📄 配置Word文档转Markdown转换...\n'));

        // 选择输入目录
        const inputDir = await this.selectPath(
            '包含Word文档(doc/docx)的输入目录', 
            this.config.docx_converter?.default_input_dir || './data/input'
        );
        
        // 选择输出目录
        const outputDir = await this.selectPath(
            'md文件的输出目录', 
            this.config.docx_converter?.default_output_dir || './data/output'
        );

        // 确认转换
        const confirm = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow('确认开始转换？'),
            default: true
        }]);

        if (!confirm.confirm) {
            return null;
        }

        return {
            inputDir: inputDir,
            outputDir: outputDir
        };
    }

    /**
     * 显示配置管理菜单
     */
    async showConfigMenu(config) {
        const choices = [
            {
                name: '👀 查看当前配置',
                value: 'view'
            },
            {
                name: '✏️  编辑配置文件',
                value: 'edit'
            },
            {
                name: '🔄 重新加载配置',
                value: 'reload'
            },
            {
                name: '⬅️  返回主菜单',
                value: 'back'
            }
        ];

        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: chalk.cyan('配置管理:'),
            choices: choices
        }]);

        return answer.action;
    }

    /**
     * 显示系统状态
     */
    async showSystemStatus(config) {
        console.log(chalk.cyan('\n📊 系统状态信息\n'));
        
        // 显示提供商信息
        console.log(chalk.yellow('🔧 LLM提供商:'));
        config.providers.forEach(provider => {
            console.log(`  ${chalk.blue(provider.name)}:`);
            provider.models.forEach(model => {
                console.log(`    - ${chalk.green(model)}`);
            });
        });

        // 显示目录信息
        console.log(chalk.yellow('\n📁 目录配置:'));
        console.log(`  输入目录: ${chalk.green(config.directories.input_dir)}`);
        console.log(`  输出目录: ${chalk.green(config.directories.output_dir)}`);
        console.log(`  候选工具目录: ${chalk.green(config.directories.candidate_tools_dir)}`);

    // 模式信息
    console.log(chalk.yellow('\n🧭 输出模式:'));
    console.log(`  默认模式: ${chalk.green(config.processing?.default_mode || 'classic')}`);
    console.log(`  允许回退: ${chalk.green(config.processing?.allow_fallback ? '是' : '否')}`);
    if (config.processing?.allow_fallback) {
      console.log(`  回退模式: ${chalk.green(config.processing?.fallback_mode || 'classic')}`);
    }

        // 显示并发配置
        console.log(chalk.yellow('\n⚡ 并发配置:'));
        console.log(`  最大并发请求数: ${chalk.green(config.concurrency.max_concurrent_requests)}`);

        // 显示校验配置
        console.log(chalk.yellow('\n✅ 校验配置:'));
        console.log(`  启用多次请求: ${chalk.green(config.validation.enable_multiple_requests ? '是' : '否')}`);
        if (config.validation.enable_multiple_requests) {
            console.log(`  请求次数: ${chalk.green(config.validation.request_count)}`);
            console.log(`  相似度阈值: ${chalk.green(config.validation.similarity_threshold)}`);
        }

        await inquirer.prompt([{
            type: 'input',
            name: 'continue',
            message: chalk.cyan('\n按回车键返回主菜单...')
        }]);
    }

    /**
     * 显示进度
     */
    showProgress(message) {
        if (this.spinner) {
            this.spinner.stop();
        }
        this.spinner = ora(message).start();
    }

    /**
     * 更新进度
     */
    updateProgress(message) {
        if (this.spinner) {
            this.spinner.text = message;
        }
    }

    /**
     * 停止进度
     */
    stopProgress() {
        if (this.spinner) {
            this.spinner.stop();
        }
    }

    /**
     * 显示成功消息
     */
    showSuccess(message) {
        console.log(chalk.green(`✅ ${message}`));
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        console.log(chalk.red(`❌ ${message}`));
    }

    /**
     * 显示警告消息
     */
    showWarning(message) {
        console.log(chalk.yellow(`⚠️  ${message}`));
    }

    /**
     * 显示信息消息
     */
    showInfo(message) {
        console.log(chalk.blue(`ℹ️  ${message}`));
    }

    /**
     * 统计文件数量
     */
    async countFiles(directory) {
        try {
            const files = await this.scanFiles(directory);
            return files.length;
        } catch (error) {
            return 0;
        }
    }

    /**
     * 扫描文件
     */
    async scanFiles(directory) {
        const files = [];
        
        const scanDir = async (dir) => {
            try {
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (this.isSupportedFile(item)) {
                        files.push({
                            path: fullPath,
                            name: item,
                            size: stat.size,
                            modified: stat.mtime
                        });
                    }
                }
            } catch (error) {
                console.error(`扫描目录失败: ${dir}`, error.message);
            }
        };

        await scanDir(directory);
        return files;
    }

    /**
     * 检查文件是否支持
     */
    isSupportedFile(filename) {
        const supportedExtensions = ['.txt', '.md', '.docx'];
        return supportedExtensions.includes(path.extname(filename).toLowerCase());
    }

    /**
     * 确认操作
     */
    async confirmAction(message, defaultValue = false) {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow(message),
            default: defaultValue
        }]);

        return answer.confirm;
    }

    /**
     * 等待用户输入
     */
    async waitForUser() {
        await inquirer.prompt([{
            type: 'input',
            name: 'continue',
            message: chalk.cyan('按回车键继续...')
        }]);
    }

    /**
     * 配置CSV合并
     */
    async configureCsvMerge(config) {
        console.log(chalk.cyan('\n📊 配置CSV合并工具...\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'inputDir',
                message: chalk.cyan('请输入包含CSV文件的目录:'),
                default: config.csv_merger?.default_input_dir || config.directories.output_dir,
                validate: (input) => {
                    if (!fs.existsSync(input)) {
                        return chalk.red('目录不存在，请重新输入');
                    }
                    return true;
                }
            },
            {
                type: 'input',
                name: 'outputDir',
                message: chalk.cyan('请输入合并后CSV文件的输出目录:'),
                default: config.csv_merger?.default_output_dir || config.directories.output_dir,
                validate: (input) => {
                    if (!input || input.trim() === '') {
                        return chalk.red('请输入输出目录路径');
                    }
                    return true;
                }
            },
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow('确认开始合并？'),
                default: true
            }
        ]);

        if (!answer.confirm) {
            return null;
        }

        return {
            inputDir: answer.inputDir,
            outputDir: answer.outputDir
        };
    }

    /**
     * 配置 CSV 清洗
     */
    async configureCsvClean(config) {
        console.log(chalk.cyan('\n🧼 配置CSV清洗工具...\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'target',
                message: chalk.cyan('请输入 CSV 文件或目录路径:'),
                default: config.directories?.output_dir || './data/output',
                validate: (input) => {
                    try {
                        const p = require('path').resolve(input);
                        if (!require('fs').existsSync(p)) return chalk.red('路径不存在');
                        return true;
                    } catch (e) {
                        return chalk.red('无效路径');
                    }
                }
            },
            {
                type: 'input',
                name: 'outputDir',
                message: chalk.cyan('请输入清洗后 CSV 的输出目录:'),
                default: config.directories?.output_dir || './data/output',
                validate: (input) => {
                    if (!input || input.trim() === '') return chalk.red('请输入输出目录');
                    return true;
                }
            },
            {
                type: 'confirm',
                name: 'treatCommonNull',
                message: chalk.cyan('是否将 NULL/N-A/— 等也视为空？'),
                default: false
            },
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow('确认开始清洗？'),
                default: true
            }
        ]);

        if (!answer.confirm) return null;
        return { target: answer.target, outputDir: answer.outputDir, treatCommonNull: answer.treatCommonNull };
    }

    /**
     * 配置模型测试
     */
    async configureModelTest(config) {
        console.log(chalk.cyan('\n🧪 配置模型测试...\n'));

        const testTypes = [
            {
                name: '🔍 测试单个模型',
                value: 'single',
                description: '选择并测试特定的模型'
            },
            {
                name: '🏢 测试单个提供商',
                value: 'provider',
                description: '测试指定提供商的所有模型'
            },
            {
                name: '🌐 测试全部模型',
                value: 'all',
                description: '测试所有配置的模型'
            }
        ];

        const testTypeAnswer = await inquirer.prompt([{
            type: 'list',
            name: 'testType',
            message: chalk.cyan('请选择测试类型:'),
            choices: testTypes
        }]);

        let testConfig = { testType: testTypeAnswer.testType };

        switch (testTypeAnswer.testType) {
            case 'single':
                const modelSelection = await this.selectModel(config.providers);
                testConfig.model = modelSelection;
                break;

            case 'provider':
                const providerChoices = config.providers.map(provider => ({
                    name: `${provider.name} (${provider.models.length}个模型)`,
                    value: provider.name
                }));
                const providerAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'provider',
                    message: chalk.cyan('请选择要测试的提供商:'),
                    choices: providerChoices
                }]);
                testConfig.provider = providerAnswer.provider;
                break;

            case 'all':
                // 不需要额外配置
                break;
        }

        // 配置测试参数
        const testParams = await inquirer.prompt([
            {
                type: 'input',
                name: 'testPrompt',
                message: chalk.cyan('测试提示词:'),
                default: config.model_tester?.default_test_prompt || '请简单回复"测试成功"',
                validate: (input) => {
                    if (!input || input.trim() === '') {
                        return chalk.red('请输入测试提示词');
                    }
                    return true;
                }
            },
            {
                type: 'number',
                name: 'timeout',
                message: chalk.cyan('响应超时时间(秒):'),
                default: config.model_tester?.default_response_timeout || (config.network?.response_timeout_ms || 60000) / 1000,
                validate: (input) => {
                    if (input < 5 || input > 600) {
                        return chalk.red('响应超时必须在5-600秒之间');
                    }
                    return true;
                }
            },
            {
                type: 'number',
                name: 'connectTimeout',
                message: chalk.cyan('连接超时时间(毫秒):'),
                default: config.model_tester?.default_connect_timeout || config.network?.connect_timeout_ms || 3000,
                validate: (input) => {
                    if (input < 200 || input > 30000) {
                        return chalk.red('连接超时必须在200-30000毫秒之间');
                    }
                    return true;
                }
            },
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow('确认开始测试？'),
                default: true
            }
        ]);

        if (!testParams.confirm) {
            return null;
        }

        return {
            ...testConfig,
            testPrompt: testParams.testPrompt,
            timeout: testParams.timeout * 1000, // 响应超时（ms）
            connectTimeout: testParams.connectTimeout
        };
    }

    /**
     * 配置网络超时参数
     */
    async configureTimeouts(defaults = {}) {
        const ans = await inquirer.prompt([
            {
                type: 'number',
                name: 'connectTimeoutMs',
                message: chalk.cyan('连接超时时间(毫秒):'),
                default: defaults.connect_timeout_ms || this.config?.network?.connect_timeout_ms || 3000,
                validate: (input) => {
                    if (input < 200 || input > 30000) {
                        return chalk.red('连接超时必须在200-30000毫秒之间');
                    }
                    return true;
                }
            },
            {
                type: 'number',
                name: 'responseTimeoutMs',
                message: chalk.cyan('响应超时时间(毫秒):'),
                default: defaults.response_timeout_ms || this.config?.network?.response_timeout_ms || 60000,
                validate: (input) => {
                    if (input < 5000 || input > 600000) {
                        return chalk.red('响应超时必须在5000-600000毫秒之间');
                    }
                    return true;
                }
            }
        ]);

        return {
            connectTimeoutMs: ans.connectTimeoutMs,
            responseTimeoutMs: ans.responseTimeoutMs
        };
    }

    /**
     * 选择输入目录或文件（支持空格键多选和目录递归选择）
     * @param {string} rootDir
     * @returns {Promise<string[]>} 选中的绝对路径列表
     */
    async selectInputs(rootDir) {
        console.log(chalk.cyan('\n📂 选择输入源'));
        console.log(chalk.gray('💡 提示: 支持空格键多选，选择目录时会自动包含该目录下的所有支持文件\n'));
        
        const sourceType = await inquirer.prompt([{
            type: 'list',
            name: 'type',
            message: chalk.cyan('请选择输入方式:'),
            choices: [
                {
                    name: '🎯 增强多选模式（推荐）- 支持空格键选择文件和目录',
                    value: 'enhanced',
                    short: '增强多选'
                },
                {
                    name: '📁 传统目录模式 - 选择单个目录处理所有文件',
                    value: 'directory',
                    short: '单目录'
                },
                {
                    name: '📄 传统文件模式 - 手动选择多个文件',
                    value: 'files',
                    short: '多文件'
                },
                {
                    name: '🛠 错误重处理批次（按时间倒序）',
                    value: 'reprocess',
                    short: '错误重处理'
                }
            ],
            default: 'enhanced'
        }]);

        switch (sourceType.type) {
            case 'enhanced':
                // 使用增强的多选模式
                console.log(chalk.yellow('\n🚀 增强多选模式:'));
                console.log(chalk.gray('- 使用 ↑↓ 键移动光标'));
                console.log(chalk.gray('- 使用 空格键 选择/取消选择文件或目录'));
                console.log(chalk.gray('- 选择目录时会自动包含该目录下的所有支持文件'));
                console.log(chalk.gray('- 使用 a 键全选，i 键反选'));
                console.log(chalk.gray('- 按回车键确认选择\n'));
                
                const selectedFiles = await this.fileSelector.select({
                    type: 'both',
                    multiple: true,
                    startPath: rootDir,
                    message: '请选择要处理的文件和目录',
                    extensions: ['.txt', '.md', '.docx']
                });
                
                return selectedFiles || [];
                
            case 'directory':
                // 选择单个目录
                const dir = await this.selectPath('输入文件目录', rootDir);
                return [dir];
                
            case 'files':
                // 传统多文件选择
                const files = await this.selectPath(
                    '选择要处理的文件', 
                    rootDir, 
                    { selectFiles: true, multiple: true }
                );
                return Array.isArray(files) ? files : [files];
            
            case 'reprocess':
                // 错误重处理候选列表
                const sel = await this.selectErrorReprocessCandidate(this.config?.directories?.output_dir || './data/output');
                if (!sel || sel.type === 'back') return [];
                if (sel.type === 'manual') {
                    const errDir = await this.selectPath('选择错误目录（某次运行的 error 子目录）', this.config?.directories?.output_dir || './data/output');
                    return { mode: 'reprocess', inputs: [errDir], reprocess: { enable: true, errorDir: errDir } };
                }
                if (sel.type === 'candidate') {
                    // 直接使用 errorDir 作为输入源目录
                    return { mode: 'reprocess', inputs: [sel.errorDir], reprocess: { enable: true, errorDir: sel.errorDir, runId: sel.runId } };
                }
                return [];
                
            default:
                return [];
        }
    }

    /**
     * 统计所选目标中的文件数（递归扫描目录，文件直接计数）
     */
    async countFilesInTargets(targets) {
        const exts = ['.txt', '.md', '.docx'];
        let total = 0;
        for (const p of targets) {
            try {
                const stat = fs.statSync(p);
                if (stat.isDirectory()) {
                    const list = await this.scanFiles(p);
                    total += list.filter(f => exts.includes(path.extname(f.path).toLowerCase())).length;
                } else {
                    if (exts.includes(path.extname(p).toLowerCase())) total += 1;
                }
            } catch (e) {
                // ignore invalid paths
            }
        }
        return total;
    }
}

module.exports = InteractiveUI;