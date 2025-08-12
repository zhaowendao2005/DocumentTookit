const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const checkboxPlus = require('./checkbox-plus-prompt');

/**
 * 自定义文件/目录选择器
 * 替代 inquirer-file-tree-selection-prompt
 */
class FileSelector {
    constructor() {
        this.currentPath = process.cwd();
        this.history = [];
    }

    /**
     * 选择文件或目录
     * @param {Object} options 选择选项
     * @param {string} options.type - 'file' | 'directory' | 'both'
     * @param {boolean} options.multiple - 是否支持多选
     * @param {string} options.startPath - 起始路径
     * @param {string} options.message - 提示消息
     * @param {string[]} options.extensions - 允许的文件扩展名 (仅对文件有效)
     * @returns {Promise<string|string[]>} 选择的路径
     */
    async select(options = {}) {
        const {
            type = 'both',
            multiple = false,
            startPath = process.cwd(),
            message = '请选择文件或目录',
            extensions = []
        } = options;

        this.currentPath = path.resolve(startPath);
        this.history = [];
        
        if (multiple) {
            return await this._selectMultiple(type, message, extensions);
        } else {
            return await this._selectSingle(type, message, extensions);
        }
    }

    /**
     * 单选模式
     */
    async _selectSingle(type, message, extensions) {
        while (true) {
            const choices = await this._buildChoices(type, extensions, false);
            
            const answer = await inquirer.prompt([{
                type: 'list',
                name: 'selection',
                message: `${message} (当前: ${chalk.cyan(this.currentPath)})`,
                choices: choices,
                pageSize: 15
            }]);

            const result = await this._handleSelection(answer.selection, type, extensions, false);
            if (result !== null) {
                return result;
            }
        }
    }

    /**
     * 多选模式 - 使用增强的空格键选择
     */
    async _selectMultiple(type, message, extensions) {
        while (true) {
            const choices = await this._buildChoicesForMultiSelect(type, extensions);
            
            if (choices.length === 0) {
                console.log(chalk.yellow('当前目录没有可选择的项目'));
                return null;
            }

            const selections = await checkboxPlus({
                message: `${message} (当前: ${chalk.cyan(this.currentPath)})`,
                choices: choices,
                pageSize: 15
            });

            // 处理选择结果
            const selectedFiles = [];
            const navigationActions = [];

            for (const selection of selections) {
                if (selection.startsWith('__')) {
                    navigationActions.push(selection);
                } else {
                    // 检查是否为目录
                    try {
                        const stat = fs.statSync(selection);
                        if (stat.isDirectory()) {
                            // 获取目录中的所有文件
                            const files = this._getAllFilesInDirectory(selection, extensions);
                            selectedFiles.push(...files);
                        } else {
                            selectedFiles.push(selection);
                        }
                    } catch (error) {
                        // 忽略无效路径
                    }
                }
            }

            // 处理导航操作
            if (navigationActions.length > 0) {
                const navAction = navigationActions[0]; // 只处理第一个导航操作
                const handled = await this._handleNavigation(navAction);
                if (!handled) {
                    continue; // 继续选择
                }
            }

            // 如果有选择的文件，显示结果并确认
            if (selectedFiles.length > 0) {
                return await this._confirmMultipleSelection(selectedFiles);
            }
        }
    }

    /**
     * 构建选择列表
     */
    async _buildChoices(type, extensions, isMultiple) {
        const choices = [];
        
        // 添加导航选项
        if (this.currentPath !== path.parse(this.currentPath).root) {
            choices.push({
                name: chalk.blue('📁 .. (上级目录)'),
                value: '__UP__',
                short: '上级目录'
            });
        }

        if (this.history.length > 0) {
            choices.push({
                name: chalk.blue('⬅️  返回上一步'),
                value: '__BACK__',
                short: '返回'
            });
        }

        if (isMultiple) {
            choices.push({
                name: chalk.green('✅ 完成选择'),
                value: '__DONE__',
                short: '完成'
            });
        }

        // 如果当前目录符合选择类型，添加选择当前目录选项
        if ((type === 'directory' || type === 'both')) {
            choices.push({
                name: chalk.green(`📁 选择当前目录: ${path.basename(this.currentPath)}`),
                value: '__CURRENT__',
                short: '当前目录'
            });
        }

        choices.push({ type: 'separator' });

        try {
            const items = fs.readdirSync(this.currentPath);
            
            for (const item of items) {
                const fullPath = path.join(this.currentPath, item);
                
                try {
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        if (type === 'directory' || type === 'both') {
                            choices.push({
                                name: `📁 ${item}`,
                                value: fullPath,
                                short: item
                            });
                        } else {
                            // 文件模式下，目录用于导航
                            choices.push({
                                name: chalk.cyan(`📁 ${item}/`),
                                value: `__DIR__${fullPath}`,
                                short: item
                            });
                        }
                    } else if (stat.isFile() && (type === 'file' || type === 'both')) {
                        // 检查文件扩展名
                        if (extensions.length === 0 || extensions.includes(path.extname(item).toLowerCase())) {
                            const icon = this._getFileIcon(path.extname(item));
                            choices.push({
                                name: `${icon} ${item}`,
                                value: fullPath,
                                short: item
                            });
                        }
                    }
                } catch (error) {
                    // 忽略无法访问的文件
                    continue;
                }
            }
        } catch (error) {
            choices.push({
                name: chalk.red('❌ 无法读取当前目录'),
                value: '__ERROR__',
                short: '错误'
            });
        }

        return choices;
    }

    /**
     * 处理用户选择
     */
    async _handleSelection(selection, type, extensions, isMultiple) {
        switch (selection) {
            case '__UP__':
                this.history.push(this.currentPath);
                this.currentPath = path.dirname(this.currentPath);
                return null;
                
            case '__BACK__':
                if (this.history.length > 0) {
                    this.currentPath = this.history.pop();
                }
                return null;
                
            case '__CURRENT__':
                return this.currentPath;
                
            case '__ERROR__':
                console.log(chalk.red('❌ 当前目录无法访问'));
                return null;
                
            default:
                if (selection.startsWith('__DIR__')) {
                    // 进入目录
                    const dirPath = selection.substring(7);
                    this.history.push(this.currentPath);
                    this.currentPath = dirPath;
                    return null;
                } else {
                    // 选择了文件或目录
                    const stat = fs.statSync(selection);
                    if (stat.isDirectory() && (type === 'file')) {
                        // 文件模式下进入目录
                        this.history.push(this.currentPath);
                        this.currentPath = selection;
                        return null;
                    } else {
                        // 确认选择
                        if (isMultiple) {
                            const confirm = await inquirer.prompt([{
                                type: 'confirm',
                                name: 'add',
                                message: `添加 "${path.basename(selection)}" 到选择列表？`,
                                default: true
                            }]);
                            return confirm.add ? selection : 'continue';
                        } else {
                            return selection;
                        }
                    }
                }
        }
    }

    /**
     * 获取文件图标
     */
    _getFileIcon(ext) {
        const iconMap = {
            '.txt': '📄',
            '.md': '📝',
            '.docx': '📘',
            '.pdf': '📕',
            '.csv': '📊',
            '.json': '📋',
            '.yaml': '⚙️',
            '.yml': '⚙️',
            '.js': '📜',
            '.ts': '📜',
            '.py': '🐍',
            '.html': '🌐',
            '.css': '🎨',
            '.jpg': '🖼️',
            '.jpeg': '🖼️',
            '.png': '🖼️',
            '.gif': '🖼️',
            '.zip': '📦',
            '.rar': '📦',
            '.7z': '📦'
        };
        
        return iconMap[ext.toLowerCase()] || '📄';
    }

    /**
     * 为多选模式构建选择列表
     */
    async _buildChoicesForMultiSelect(type, extensions) {
        const choices = [];
        
        // 添加导航选项
        if (this.currentPath !== path.parse(this.currentPath).root) {
            choices.push({
                name: chalk.blue('📁 .. (上级目录)'),
                value: '__UP__',
                short: '上级目录'
            });
        }

        if (this.history.length > 0) {
            choices.push({
                name: chalk.blue('⬅️  返回上一步'),
                value: '__BACK__',
                short: '返回'
            });
        }

        choices.push({ type: 'separator' });

        try {
            const items = fs.readdirSync(this.currentPath);
            
            for (const item of items) {
                const fullPath = path.join(this.currentPath, item);
                
                try {
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        if (type === 'directory' || type === 'both') {
                            choices.push({
                                name: `📁 ${item}`,
                                value: fullPath,
                                short: item,
                                isDirectory: true
                            });
                        }
                    } else if (stat.isFile() && (type === 'file' || type === 'both')) {
                        // 检查文件扩展名
                        if (extensions.length === 0 || extensions.includes(path.extname(item).toLowerCase())) {
                            const icon = this._getFileIcon(path.extname(item));
                            choices.push({
                                name: `${icon} ${item}`,
                                value: fullPath,
                                short: item,
                                isDirectory: false
                            });
                        }
                    }
                } catch (error) {
                    // 忽略无法访问的文件
                    continue;
                }
            }
        } catch (error) {
            choices.push({
                name: chalk.red('❌ 无法读取当前目录'),
                value: '__ERROR__',
                short: '错误'
            });
        }

        return choices;
    }

    /**
     * 处理导航操作
     */
    async _handleNavigation(action) {
        switch (action) {
            case '__UP__':
                this.history.push(this.currentPath);
                this.currentPath = path.dirname(this.currentPath);
                return false; // 继续选择
                
            case '__BACK__':
                if (this.history.length > 0) {
                    this.currentPath = this.history.pop();
                }
                return false; // 继续选择
                
            case '__ERROR__':
                console.log(chalk.red('❌ 当前目录无法访问'));
                return false; // 继续选择
                
            default:
                return false;
        }
    }

    /**
     * 递归获取目录中的所有文件
     */
    _getAllFilesInDirectory(dirPath, extensions = []) {
        const files = [];
        
        const scanDir = (dir) => {
            try {
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        scanDir(fullPath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(item).toLowerCase();
                        if (extensions.length === 0 || extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                // 忽略无法访问的目录
            }
        };
        
        scanDir(dirPath);
        return files;
    }

    /**
     * 确认多选结果
     */
    async _confirmMultipleSelection(selectedFiles) {
        // 去重
        const uniqueFiles = [...new Set(selectedFiles)];
        
        console.log(chalk.cyan(`\n🎯 已选择 ${uniqueFiles.length} 个文件:`));
        console.log(chalk.gray('─'.repeat(50)));
        
        uniqueFiles.forEach((file, index) => {
            const relativePath = path.relative(process.cwd(), file);
            const icon = this._getFileIcon(path.extname(file));
            console.log(chalk.green(`  ${index + 1}. ${icon} ${relativePath}`));
        });
        
        console.log(chalk.gray('─'.repeat(50)));
        
        const confirm = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow('确认选择这些文件？'),
            default: true
        }]);

        if (confirm.confirm) {
            return uniqueFiles;
        } else {
            return null; // 重新选择
        }
    }

    /**
     * 快速目录选择 (简化版，用于向后兼容)
     */
    async selectDirectory(message = '选择目录', startPath = process.cwd()) {
        return await this.select({
            type: 'directory',
            message: message,
            startPath: startPath,
            multiple: false
        });
    }

    /**
     * 快速文件选择 (简化版，用于向后兼容)
     */
    async selectFile(message = '选择文件', startPath = process.cwd(), extensions = []) {
        return await this.select({
            type: 'file',
            message: message,
            startPath: startPath,
            multiple: false,
            extensions: extensions
        });
    }

    /**
     * 快速多文件选择 (简化版，用于向后兼容)
     */
    async selectFiles(message = '选择文件', startPath = process.cwd(), extensions = []) {
        return await this.select({
            type: 'file',
            message: message,
            startPath: startPath,
            multiple: true,
            extensions: extensions
        });
    }
}

module.exports = FileSelector;
