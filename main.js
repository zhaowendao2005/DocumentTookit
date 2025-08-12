const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const ConfigLoader = require('./config/config-loader');
const InteractiveUI = require('./modules/ui-interactive');
const DocxToMdConverter = require('./tools/docx_to_md_converter');
const FileProcessor = require('./modules/file-processor');
const ModelTester = require('./modules/model-tester');
const CsvMerger = require('./utils/csv-merger');

class MainApplication {
    constructor() {
        this.config = null;
        this.ui = new InteractiveUI();
    }

    /**
     * 启动应用
     */
    async start() {
        try {
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
                        
                    case 'docx_to_md':
                        await this.handleDocxToMd();
                        break;
                        
                    case 'model_test':
                        await this.handleModelTest();
                        break;
                        
                    case 'csv_merge':
                        await this.handleCsvMerge();
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

            // 执行批量处理
            const processor = new FileProcessor({ config: this.config, logger: console });
            this.ui.showInfo('开始批量处理...');
            const result = await processor.runBatch(
                { ...setup.model, timeouts: setup.timeouts, validation: setup.validation },
                setup.inputDir,
                setup.outputDir
            );

            this.ui.showSuccess(`处理完成：总数=${result.total} 成功=${result.succeeded} 失败=${result.failed}`);
            
        } catch (error) {
            this.ui.showError(`批量LLM处理失败: ${error.message}`);
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
    main().catch(error => {
        console.error(chalk.red('❌ 程序执行失败:'), error.message);
        process.exit(1);
    });
}

module.exports = MainApplication;