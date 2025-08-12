const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * 通用文本分割工具
 * 支持多级正则表达式分割，生成层级目录结构
 */
class TextSplitter {
    constructor() {
        this.levels = []; // 层级配置
        this.splitResults = []; // 分割结果
        this.sourceContent = ''; // 源文本内容
    }

    /**
     * 添加分割层级
     * @param {Object} levelConfig 层级配置
     * @param {string} levelConfig.name 层级名称
     * @param {string} levelConfig.regex 正则表达式
     * @param {string} levelConfig.description 层级描述
     */
    addLevel(levelConfig) {
        this.levels.push({
            name: levelConfig.name,
            regex: levelConfig.regex,
            description: levelConfig.description || '',
            compiled: new RegExp(levelConfig.regex, 'gm')
        });
    }

    /**
     * 清空所有层级配置
     */
    clearLevels() {
        this.levels = [];
        this.splitResults = [];
    }

    /**
     * 加载源文本文件
     * @param {string} filePath 文件路径
     */
    loadSourceFile(filePath) {
        try {
            this.sourceContent = fs.readFileSync(filePath, 'utf-8');
            console.log(chalk.green(`✅ 成功加载源文件: ${filePath}`));
            console.log(chalk.gray(`文件大小: ${(this.sourceContent.length / 1024).toFixed(2)} KB`));
            return true;
        } catch (error) {
            console.error(chalk.red(`❌ 加载源文件失败: ${error.message}`));
            return false;
        }
    }

    /**
     * 执行文本分割
     * @returns {Array} 分割结果
     */
    splitText() {
        if (!this.sourceContent) {
            throw new Error('请先加载源文本文件');
        }

        if (this.levels.length === 0) {
            throw new Error('请先配置分割层级');
        }

        this.splitResults = [];
        this._splitRecursive(this.sourceContent, 0, '', []);
        
        return this.splitResults;
    }

    /**
     * 递归分割文本
     * @param {string} content 当前层级的内容
     * @param {number} levelIndex 当前层级索引
     * @param {string} parentPath 父级路径
     * @param {Array} parentMatches 父级匹配结果
     */
    _splitRecursive(content, levelIndex, parentPath, parentMatches) {
        if (levelIndex >= this.levels.length) {
            // 到达最底层，保存内容
            this.splitResults.push({
                path: parentPath,
                content: content.trim(),
                matches: [...parentMatches],
                level: levelIndex - 1
            });
            return;
        }

        const level = this.levels[levelIndex];
        const regex = level.compiled;
        const matches = [];
        let lastIndex = 0;

        // 重置正则表达式状态
        regex.lastIndex = 0;

        let match;
        while ((match = regex.exec(content)) !== null) {
            matches.push({
                text: match[0],
                index: match.index,
                groups: match.slice(1),
                fullMatch: match[0]
            });
        }

        if (matches.length === 0) {
            // 当前层级没有匹配，直接进入下一层级
            this._splitRecursive(content, levelIndex + 1, parentPath, parentMatches);
            return;
        }

        // 处理每个匹配项
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const nextMatch = matches[i + 1];
            
            // 计算当前匹配项的内容范围
            const startIndex = match.index;
            const endIndex = nextMatch ? nextMatch.index : content.length;
            const matchContent = content.substring(startIndex, endIndex);

            // 构建当前路径
            const currentPath = parentPath ? `${parentPath}/${match.fullMatch.trim()}` : match.fullMatch.trim();
            
            // 递归处理下一层级
            this._splitRecursive(
                matchContent, 
                levelIndex + 1, 
                currentPath, 
                [...parentMatches, { level: level.name, match: match.fullMatch, groups: match.groups }]
            );
        }
    }

    /**
     * 预览分割结果（树形结构）
     */
    previewSplitResults() {
        if (this.splitResults.length === 0) {
            console.log(chalk.yellow('⚠️  请先执行文本分割'));
            return;
        }

        console.log(chalk.cyan('\n📊 分割结果预览 (树形结构)\n'));
        
        // 构建树形结构
        const tree = this._buildTree();
        this._printTree(tree, 0);
        
        console.log(chalk.gray(`\n总计: ${this.splitResults.length} 个分割片段`));
    }

    /**
     * 构建树形结构
     */
    _buildTree() {
        const tree = {};
        
        for (const result of this.splitResults) {
            const pathParts = result.path.split('/');
            let current = tree;
            
            for (let i = 0; i < pathParts.length; i++) {
                const part = pathParts[i];
                if (!current[part]) {
                    current[part] = { type: 'node', children: {}, results: [] };
                }
                if (i === pathParts.length - 1) {
                    current[part].type = 'leaf';
                    current[part].results.push(result);
                }
                current = current[part].children;
            }
        }
        
        return tree;
    }

    /**
     * 打印树形结构
     */
    _printTree(node, depth, prefix = '') {
        const indent = '  '.repeat(depth);
        const isLast = true; // 简化版本，总是显示为最后一项
        
        for (const [key, value] of Object.entries(node)) {
            if (key === 'type' || key === 'children' || key === 'results') continue;
            
            const connector = depth === 0 ? '📁' : (value.type === 'leaf' ? '📄' : '📁');
            const name = key.length > 30 ? key.substring(0, 27) + '...' : key;
            
            if (value.type === 'leaf') {
                console.log(`${indent}${connector} ${chalk.green(name)} (${value.results.length} 片段)`);
            } else {
                console.log(`${indent}${connector} ${chalk.blue(name)}`);
                this._printTree(value.children, depth + 1);
            }
        }
    }

    /**
     * 导出分割结果到目录
     * @param {string} outputDir 输出目录
     * @param {Object} options 导出选项
     */
    exportSplitResults(outputDir, options = {}) {
        if (this.splitResults.length === 0) {
            throw new Error('请先执行文本分割');
        }

        const {
            fileExtension = '.txt',
            includeMetadata = true,
            flattenStructure = false
        } = options;

        // 创建输出目录
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const exportedFiles = [];

        for (const result of this.splitResults) {
            try {
                let filePath;
                
                if (flattenStructure) {
                    // 扁平化结构：使用路径作为文件名
                    const safeFileName = result.path.replace(/[<>:"/\\|?*]/g, '_');
                    filePath = path.join(outputDir, `${safeFileName}${fileExtension}`);
                } else {
                    // 层级结构：创建目录
                    const dirPath = path.join(outputDir, result.path);
                    if (!fs.existsSync(dirPath)) {
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    filePath = path.join(dirPath, `content${fileExtension}`);
                }

                // 准备文件内容
                let content = result.content;
                
                if (includeMetadata) {
                    const metadata = this._generateMetadata(result);
                    content = metadata + '\n\n' + content;
                }

                // 写入文件
                fs.writeFileSync(filePath, content, 'utf-8');
                exportedFiles.push(filePath);
                
            } catch (error) {
                console.error(chalk.red(`导出文件失败: ${result.path} - ${error.message}`));
            }
        }

        console.log(chalk.green(`✅ 成功导出 ${exportedFiles.length} 个文件到: ${outputDir}`));
        return exportedFiles;
    }

    /**
     * 生成元数据
     */
    _generateMetadata(result) {
        const metadata = [
            `# 文本分割结果`,
            `路径: ${result.path}`,
            `层级: ${result.level + 1}`,
            `生成时间: ${new Date().toISOString()}`,
            `内容长度: ${result.content.length} 字符`,
            '',
            '## 匹配历史',
        ];

        for (let i = 0; i < result.matches.length; i++) {
            const match = result.matches[i];
            metadata.push(`${i + 1}. ${match.level}: ${match.match}`);
            if (match.groups && match.groups.length > 0) {
                metadata.push(`   捕获组: ${match.groups.join(', ')}`);
            }
        }

        return metadata.join('\n');
    }

    /**
     * 验证正则表达式
     * @param {string} regexString 正则表达式字符串
     * @returns {boolean} 是否有效
     */
    validateRegex(regexString) {
        try {
            new RegExp(regexString, 'gm');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 测试正则表达式
     * @param {string} regexString 正则表达式字符串
     * @param {string} testContent 测试内容
     * @returns {Array} 匹配结果
     */
    testRegex(regexString, testContent) {
        try {
            const regex = new RegExp(regexString, 'gm');
            const matches = [];
            let match;
            
            while ((match = regex.exec(testContent)) !== null) {
                matches.push({
                    text: match[0],
                    index: match.index,
                    groups: match.slice(1)
                });
            }
            
            return matches;
        } catch (error) {
            throw new Error(`正则表达式无效: ${error.message}`);
        }
    }

    /**
     * 获取当前配置信息
     */
    getConfiguration() {
        return {
            levels: this.levels.map(level => ({
                name: level.name,
                regex: level.regex,
                description: level.description
            })),
            sourceLoaded: !!this.sourceContent,
            sourceSize: this.sourceContent ? this.sourceContent.length : 0,
            resultsCount: this.splitResults.length
        };
    }
}

module.exports = TextSplitter;
