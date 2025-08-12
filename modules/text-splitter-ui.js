const inquirer = require('inquirer');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const TextSplitter = require('../utils/text-splitter');

/**
 * 文本分割工具的交互式UI
 */
class TextSplitterUI {
    constructor() {
        this.splitter = new TextSplitter();
    }

    /**
     * 显示主菜单
     */
    async showMainMenu() {
        const choices = [
            {
                name: '📁 加载源文件',
                value: 'load_source',
                description: '选择要分割的源文本文件'
            },
            {
                name: '⚙️  配置分割层级',
                value: 'configure_levels',
                description: '添加、编辑或删除分割层级'
            },
            {
                name: '👀 预览分割结果',
                value: 'preview',
                description: '预览按当前配置分割后的树形结构'
            },
            {
                name: '📤 导出分割结果',
                value: 'export',
                description: '将分割结果导出到指定目录'
            },
            {
                name: '📊 查看当前配置',
                value: 'view_config',
                description: '查看当前的分割配置和状态'
            },
            {
                name: '🧪 测试正则表达式',
                value: 'test_regex',
                description: '测试正则表达式在源文本中的匹配效果'
            },
            {
                name: '🔄 重置配置',
                value: 'reset',
                description: '清空所有分割层级配置'
            },
            {
                name: '⬅️  返回上级菜单',
                value: 'back'
            }
        ];

        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: chalk.cyan('文本分割工具 - 请选择操作:'),
            choices: choices,
            pageSize: 10
        }]);

        return answer.action;
    }

    /**
     * 加载源文件
     */
    async loadSourceFile() {
        console.log(chalk.cyan('\n📁 加载源文件\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'filePath',
                message: chalk.cyan('请输入源文件路径:'),
                default: './input/source.txt',
                validate: (input) => {
                    if (!fs.existsSync(input)) {
                        return chalk.red('文件不存在，请重新输入');
                    }
                    return true;
                }
            }
        ]);

        const success = this.splitter.loadSourceFile(answer.filePath);
        if (success) {
            console.log(chalk.green('✅ 源文件加载成功！'));
        }
    }

    /**
     * 配置分割层级
     */
    async configureLevels() {
        console.log(chalk.cyan('\n⚙️  配置分割层级\n'));

        while (true) {
            const action = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: chalk.cyan('请选择操作:'),
                choices: [
                    { name: '➕ 添加新层级', value: 'add' },
                    { name: '✏️  编辑层级', value: 'edit' },
                    { name: '🗑️  删除层级', value: 'delete' },
                    { name: '👀 查看当前层级', value: 'view' },
                    { name: '⬅️  返回', value: 'back' }
                ]
            }]);

            switch (action.action) {
                case 'add':
                    await this.addLevel();
                    break;
                case 'edit':
                    await this.editLevel();
                    break;
                case 'delete':
                    await this.deleteLevel();
                    break;
                case 'view':
                    this.viewLevels();
                    break;
                case 'back':
                    return;
            }
        }
    }

    /**
     * 添加新层级
     */
    async addLevel() {
        console.log(chalk.cyan('\n➕ 添加新层级\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: chalk.cyan('层级名称:'),
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('层级名称不能为空');
                    }
                    return true;
                }
            },
            {
                type: 'input',
                name: 'regex',
                message: chalk.cyan('正则表达式:'),
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('正则表达式不能为空');
                    }
                    if (!this.splitter.validateRegex(input)) {
                        return chalk.red('正则表达式格式无效');
                    }
                    return true;
                }
            },
            {
                type: 'input',
                name: 'description',
                message: chalk.cyan('层级描述 (可选):'),
                default: ''
            }
        ]);

        this.splitter.addLevel({
            name: answer.name,
            regex: answer.regex,
            description: answer.description
        });

        console.log(chalk.green(`✅ 成功添加层级: ${answer.name}`));
    }

    /**
     * 编辑层级
     */
    async editLevel() {
        if (this.splitter.levels.length === 0) {
            console.log(chalk.yellow('⚠️  当前没有配置任何层级'));
            return;
        }

        const levelChoices = this.splitter.levels.map((level, index) => ({
            name: `${index + 1}. ${level.name} - ${level.regex}`,
            value: index
        }));

        const levelIndex = await inquirer.prompt([{
            type: 'list',
            name: 'index',
            message: chalk.cyan('请选择要编辑的层级:'),
            choices: levelChoices
        }]);

        const level = this.splitter.levels[levelIndex.index];
        
        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: chalk.cyan('层级名称:'),
                default: level.name,
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('层级名称不能为空');
                    }
                    return true;
                }
            },
            {
                type: 'input',
                name: 'regex',
                message: chalk.cyan('正则表达式:'),
                default: level.regex,
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('正则表达式不能为空');
                    }
                    if (!this.splitter.validateRegex(input)) {
                        return chalk.red('正则表达式格式无效');
                    }
                    return true;
                }
            },
            {
                type: 'input',
                name: 'description',
                message: chalk.cyan('层级描述:'),
                default: level.description
            }
        ]);

        // 更新层级
        level.name = answer.name;
        level.regex = answer.regex;
        level.description = answer.description;
        level.compiled = new RegExp(answer.regex, 'gm');

        console.log(chalk.green(`✅ 成功更新层级: ${answer.name}`));
    }

    /**
     * 删除层级
     */
    async deleteLevel() {
        if (this.splitter.levels.length === 0) {
            console.log(chalk.yellow('⚠️  当前没有配置任何层级'));
            return;
        }

        const levelChoices = this.splitter.levels.map((level, index) => ({
            name: `${index + 1}. ${level.name} - ${level.regex}`,
            value: index
        }));

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'index',
                message: chalk.cyan('请选择要删除的层级:'),
                choices: levelChoices
            },
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow('确认删除这个层级？'),
                default: false
            }
        ]);

        if (answer.confirm) {
            const deletedLevel = this.splitter.levels.splice(answer.index, 1)[0];
            console.log(chalk.green(`✅ 成功删除层级: ${deletedLevel.name}`));
        }
    }

    /**
     * 查看当前层级
     */
    viewLevels() {
        console.log(chalk.cyan('\n📊 当前分割层级配置:\n'));

        if (this.splitter.levels.length === 0) {
            console.log(chalk.yellow('暂无配置的分割层级'));
            return;
        }

        this.splitter.levels.forEach((level, index) => {
            console.log(chalk.blue(`${index + 1}. ${level.name}`));
            console.log(chalk.gray(`   正则: ${level.regex}`));
            if (level.description) {
                console.log(chalk.gray(`   描述: ${level.description}`));
            }
            console.log('');
        });
    }

    /**
     * 预览分割结果
     */
    async previewSplitResults() {
        if (!this.splitter.sourceContent) {
            console.log(chalk.yellow('⚠️  请先加载源文件'));
            return;
        }

        if (this.splitter.levels.length === 0) {
            console.log(chalk.yellow('⚠️  请先配置分割层级'));
            return;
        }

        console.log(chalk.cyan('\n👀 正在执行文本分割...\n'));

        try {
            this.splitter.splitText();
            this.splitter.previewSplitResults();
        } catch (error) {
            console.error(chalk.red(`❌ 分割失败: ${error.message}`));
        }
    }

    /**
     * 导出分割结果
     */
    async exportSplitResults() {
        if (this.splitter.splitResults.length === 0) {
            console.log(chalk.yellow('⚠️  请先预览分割结果'));
            return;
        }

        console.log(chalk.cyan('\n📤 导出分割结果\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'outputDir',
                message: chalk.cyan('输出目录:'),
                default: './output/split_results',
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('输出目录不能为空');
                    }
                    return true;
                }
            },
            {
                type: 'list',
                name: 'fileExtension',
                message: chalk.cyan('文件扩展名:'),
                choices: [
                    { name: '.txt', value: '.txt' },
                    { name: '.md', value: '.md' },
                    { name: '.yaml', value: '.yaml' }
                ]
            },
            {
                type: 'confirm',
                name: 'includeMetadata',
                message: chalk.cyan('是否在文件中包含元数据信息？'),
                default: true
            },
            {
                type: 'confirm',
                name: 'flattenStructure',
                message: chalk.cyan('是否使用扁平化结构（所有文件在同一目录）？'),
                default: false
            },
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow('确认开始导出？'),
                default: true
            }
        ]);

        if (!answer.confirm) {
            return;
        }

        try {
            const exportedFiles = this.splitter.exportSplitResults(answer.outputDir, {
                fileExtension: answer.fileExtension,
                includeMetadata: answer.includeMetadata,
                flattenStructure: answer.flattenStructure
            });

            console.log(chalk.green(`\n✅ 导出完成！共导出 ${exportedFiles.length} 个文件`));
        } catch (error) {
            console.error(chalk.red(`❌ 导出失败: ${error.message}`));
        }
    }

    /**
     * 查看当前配置
     */
    viewConfiguration() {
        console.log(chalk.cyan('\n📊 当前配置信息\n'));

        const config = this.splitter.getConfiguration();
        
        console.log(chalk.blue('📁 分割层级:'));
        if (config.levels.length === 0) {
            console.log(chalk.yellow('  暂无配置'));
        } else {
            config.levels.forEach((level, index) => {
                console.log(chalk.green(`  ${index + 1}. ${level.name}`));
                console.log(chalk.gray(`     正则: ${level.regex}`));
                if (level.description) {
                    console.log(chalk.gray(`     描述: ${level.description}`));
                }
            });
        }

        console.log(chalk.blue('\n📄 源文件状态:'));
        if (config.sourceLoaded) {
            console.log(chalk.green(`  已加载 (${(config.sourceSize / 1024).toFixed(2)} KB)`));
        } else {
            console.log(chalk.yellow('  未加载'));
        }

        console.log(chalk.blue('\n📊 分割结果:'));
        console.log(chalk.green(`  共 ${config.resultsCount} 个片段`));
    }

    /**
     * 测试正则表达式
     */
    async testRegex() {
        if (!this.splitter.sourceContent) {
            console.log(chalk.yellow('⚠️  请先加载源文件'));
            return;
        }

        console.log(chalk.cyan('\n🧪 测试正则表达式\n'));

        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'regex',
                message: chalk.cyan('请输入要测试的正则表达式:'),
                validate: (input) => {
                    if (!input.trim()) {
                        return chalk.red('正则表达式不能为空');
                    }
                    if (!this.splitter.validateRegex(input)) {
                        return chalk.red('正则表达式格式无效');
                    }
                    return true;
                }
            }
        ]);

        try {
            const matches = this.splitter.testRegex(answer.regex, this.splitter.sourceContent);
            
            console.log(chalk.green(`\n✅ 测试结果: 找到 ${matches.length} 个匹配项\n`));
            
            if (matches.length > 0) {
                console.log(chalk.cyan('前10个匹配项:'));
                matches.slice(0, 10).forEach((match, index) => {
                    console.log(chalk.blue(`${index + 1}. 位置 ${match.index}: ${match.text.substring(0, 50)}${match.text.length > 50 ? '...' : ''}`));
                    if (match.groups && match.groups.length > 0) {
                        console.log(chalk.gray(`   捕获组: ${match.groups.join(', ')}`));
                    }
                });
                
                if (matches.length > 10) {
                    console.log(chalk.gray(`... 还有 ${matches.length - 10} 个匹配项`));
                }
            }
        } catch (error) {
            console.error(chalk.red(`❌ 测试失败: ${error.message}`));
        }
    }

    /**
     * 重置配置
     */
    async resetConfiguration() {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow('确认重置所有配置？这将清空所有分割层级和结果。'),
            default: false
        }]);

        if (answer.confirm) {
            this.splitter.clearLevels();
            console.log(chalk.green('✅ 配置已重置'));
        }
    }

    /**
     * 运行主循环
     */
    async run() {
        console.log(chalk.cyan('🚀 文本分割工具启动\n'));
        console.log(chalk.gray('这是一个通用的文本分割工具，支持多级正则表达式分割\n'));

        while (true) {
            try {
                const action = await this.showMainMenu();
                
                switch (action) {
                    case 'load_source':
                        await this.loadSourceFile();
                        break;
                    case 'configure_levels':
                        await this.configureLevels();
                        break;
                    case 'preview':
                        await this.previewSplitResults();
                        break;
                    case 'export':
                        await this.exportSplitResults();
                        break;
                    case 'view_config':
                        this.viewConfiguration();
                        break;
                    case 'test_regex':
                        await this.testRegex();
                        break;
                    case 'reset':
                        await this.resetConfiguration();
                        break;
                    case 'back':
                        return;
                }

                if (action !== 'back') {
                    await inquirer.prompt([{
                        type: 'input',
                        name: 'continue',
                        message: chalk.cyan('按回车键继续...')
                    }]);
                }

            } catch (error) {
                console.error(chalk.red(`❌ 操作执行失败: ${error.message}`));
                await inquirer.prompt([{
                    type: 'input',
                    name: 'continue',
                    message: chalk.cyan('按回车键继续...')
                }]);
            }
        }
    }
}

module.exports = TextSplitterUI;
