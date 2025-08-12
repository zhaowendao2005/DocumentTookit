const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const gradient = require('gradient-string');

class InteractiveUI {
    constructor() {
        this.spinner = null;
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
                name: '📄 Docx转Markdown',
                value: 'docx_to_md',
                description: '批量转换Word文档为Markdown格式'
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
        
        // 2. 选择输入目录
        const inputDir = await this.selectDirectory('输入文件目录', config.directories.input_dir);
        
        // 3. 选择输出目录
        const outputDir = await this.selectDirectory('输出目录', config.directories.output_dir);
        
        // 4. 显示文件数量
        const fileCount = await this.countFiles(inputDir);
        console.log(chalk.green(`\n�� 发现 ${fileCount} 个待处理文件`));
        
        // 5. 配置校验
        const validationConfig = await this.configureValidation(config.validation);

        // 6. 覆盖时间参数
        const timeoutConfig = await this.configureTimeouts(config.network || {});

        return {
            model: modelSelection,
            inputDir: inputDir,
            outputDir: outputDir,
            fileCount: fileCount,
            validation: validationConfig,
            timeouts: timeoutConfig
        };
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
     * 选择目录
     */
    async selectDirectory(title, defaultPath) {
        const answer = await inquirer.prompt([{
            type: 'input',
            name: 'directory',
            message: chalk.cyan(`${title}:`),
            default: defaultPath,
            validate: (input) => {
                if (!fs.existsSync(input)) {
                    return chalk.red('目录不存在，请重新输入');
                }
                return true;
            }
        }]);

        return answer.directory;
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
     * 配置Docx转Md转换
     */
    async configureDocxToMd() {
        console.log(chalk.cyan('\n📄 配置Docx转Markdown转换...\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'inputDir',
                message: chalk.cyan('请输入包含docx文件的输入目录:'),
                default: './input',
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
                message: chalk.cyan('请输入md文件的输出目录:'),
                default: './output',
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
                message: chalk.yellow('确认开始转换？'),
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
                default: config.directories.output_dir,
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
                default: config.directories.output_dir,
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
                default: '请简单回复"测试成功"',
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
                default: (config.network?.response_timeout_ms || 60000) / 1000,
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
                default: config.network?.connect_timeout_ms || 3000,
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
                default: defaults.connect_timeout_ms || 3000,
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
                default: defaults.response_timeout_ms || 60000,
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
}

module.exports = InteractiveUI;