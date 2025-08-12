const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const ConfigLoader = require('./config/config-loader');
const InteractiveUI = require('./modules/ui-interactive');
const DocxToMdConverter = require('./tools/docx_to_md_converter');

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

            this.ui.showInfo('批量LLM处理功能正在开发中...');
            // TODO: 实现批量LLM处理逻辑
            
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