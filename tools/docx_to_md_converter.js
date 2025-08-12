const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const inquirer = require('inquirer');

/**
 * 批量将docx文件转换为md文件，保留目录结构
 * 使用pandoc进行转换
 */
class DocxToMdConverter {
    constructor() {
        this.supportedExtensions = ['.docx'];
        this.convertedCount = 0;
        this.errorCount = 0;
        this.errors = [];
    }

    /**
     * 检查pandoc是否可用
     * @returns {boolean}
     */
    checkPandoc() {
        try {
            execSync('pandoc --version', { stdio: 'ignore' });
            return true;
        } catch (error) {
            console.error('❌ Pandoc未安装或不在PATH中');
            console.error('请确保已安装pandoc并添加到系统PATH');
            return false;
        }
    }

    /**
     * 创建输出目录
     * @param {string} outputPath 
     */
    createOutputDir(outputPath) {
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
            console.log(`📁 创建输出目录: ${outputPath}`);
        }
    }

    /**
     * 转换单个docx文件为md
     * @param {string} inputFile 
     * @param {string} outputFile 
     * @returns {boolean}
     */
    convertFile(inputFile, outputFile) {
        try {
            // 确保输出目录存在
            const outputDir = path.dirname(outputFile);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // 使用pandoc转换文件，处理Windows路径问题
            let command;
            if (process.platform === 'win32') {
                // Windows系统使用双引号包围路径，并转义内部的双引号
                const escapedInputFile = inputFile.replace(/"/g, '""');
                const escapedOutputFile = outputFile.replace(/"/g, '""');
                command = `pandoc "${escapedInputFile}" -o "${escapedOutputFile}" --to markdown --wrap=none`;
            } else {
                // Unix系统
                command = `pandoc "${inputFile}" -o "${outputFile}" --to markdown --wrap=none`;
            }

            execSync(command, { stdio: 'pipe' });

            console.log(`✅ 转换成功: ${path.basename(inputFile)} -> ${path.basename(outputFile)}`);
            this.convertedCount++;
            return true;
        } catch (error) {
            console.error(`❌ 转换失败: ${path.basename(inputFile)}`);
            console.error(`   错误信息: ${error.message}`);
            this.errorCount++;
            this.errors.push({
                file: inputFile,
                error: error.message
            });
            return false;
        }
    }

    /**
     * 递归处理目录
     * @param {string} inputDir 
     * @param {string} outputDir 
     */
    processDirectory(inputDir, outputDir) {
        try {
            const items = fs.readdirSync(inputDir);

            for (const item of items) {
                const inputPath = path.join(inputDir, item);
                const outputPath = path.join(outputDir, item);
                
                try {
                    const stat = fs.statSync(inputPath);

                    if (stat.isDirectory()) {
                        // 递归处理子目录
                        this.processDirectory(inputPath, outputPath);
                    } else if (stat.isFile()) {
                        // 检查是否为支持的文档格式
                        const ext = path.extname(item).toLowerCase();
                        if (this.supportedExtensions.includes(ext)) {
                            // 生成输出文件路径（将.docx替换为.md）
                            const outputFile = outputPath.replace(ext, '.md');
                            this.convertFile(inputPath, outputFile);
                        }
                    }
                } catch (statError) {
                    console.warn(`⚠️  无法访问路径: ${inputPath} - ${statError.message}`);
                    continue;
                }
            }
        } catch (readError) {
            console.error(`❌ 无法读取目录: ${inputDir} - ${readError.message}`);
        }
    }

    /**
     * 开始批量转换
     * @param {string} inputDir 
     * @param {string} outputDir 
     */
    convert(inputDir, outputDir) {
        console.log('🚀 开始批量转换docx文件为md文件...\n');

        // 检查pandoc
        if (!this.checkPandoc()) {
            return false;
        }

        // 检查输入目录
        if (!fs.existsSync(inputDir)) {
            console.error(`❌ 输入目录不存在: ${inputDir}`);
            return false;
        }

        // 验证输入目录是否为目录
        try {
            const stat = fs.statSync(inputDir);
            if (!stat.isDirectory()) {
                console.error(`❌ 输入路径不是目录: ${inputDir}`);
                return false;
            }
        } catch (error) {
            console.error(`❌ 无法访问输入目录: ${inputDir} - ${error.message}`);
            return false;
        }

        // 创建输出目录
        this.createOutputDir(outputDir);

        // 开始转换
        const startTime = Date.now();
        this.processDirectory(inputDir, outputDir);
        const endTime = Date.now();

        // 输出统计信息
        this.printSummary(startTime, endTime);

        return this.errorCount === 0;
    }

    /**
     * 打印转换统计信息
     * @param {number} startTime 
     * @param {number} endTime 
     */
    printSummary(startTime, endTime) {
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.log('\n📊 转换完成统计:');
        console.log(`   总转换文件数: ${this.convertedCount}`);
        console.log(`   成功转换数: ${this.convertedCount - this.errorCount}`);
        console.log(`   失败转换数: ${this.errorCount}`);
        console.log(`   总耗时: ${duration}秒`);

        if (this.errors.length > 0) {
            console.log('\n❌ 转换失败的文件:');
            this.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${path.basename(error.file)}`);
                console.log(`      错误: ${error.error}`);
            });
        }

        if (this.errorCount === 0) {
            console.log('\n🎉 所有文件转换成功！');
        } else {
            console.log(`\n⚠️  有 ${this.errorCount} 个文件转换失败，请检查错误信息`);
        }
    }
}

/**
 * 验证路径是否有效
 * @param {string} inputPath 
 * @returns {string|null} 返回验证后的路径或null
 */
function validatePath(inputPath) {
    if (!inputPath) {
        return null;
    }

    try {
        // 处理可能的引号问题
        let cleanPath = inputPath.trim();
        if (cleanPath.startsWith('"') && cleanPath.endsWith('"')) {
            cleanPath = cleanPath.slice(1, -1);
        }

        // 解析路径
        const resolvedPath = path.resolve(cleanPath);
        
        // 检查路径是否存在
        if (!fs.existsSync(resolvedPath)) {
            return null;
        }

        // 检查是否为目录
        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
            return null;
        }

        return resolvedPath;
    } catch (error) {
        console.log(`路径验证错误: ${error.message}`);
        return null;
    }
}

/**
 * 交互式询问用户路径
 * @returns {Promise<{inputDir: string, outputDir: string}>}
 */
async function askForPaths() {
    console.log('📖 Docx转Markdown批量转换器\n');
    console.log('请选择输入目录和输出目录：\n');

    const questions = [
        {
            type: 'input',
            name: 'inputDir',
            message: '请输入包含docx文件的输入目录路径:',
            default: process.cwd(),
            validate: (input) => {
                const validPath = validatePath(input);
                if (!validPath) {
                    return '请输入有效的目录路径';
                }
                return true;
            },
            filter: (input) => {
                return validatePath(input) || input;
            }
        },
        {
            type: 'input',
            name: 'outputDir',
            message: '请输入md文件的输出目录路径:',
            default: path.join(process.cwd(), 'output'),
            validate: (input) => {
                if (!input || input.trim() === '') {
                    return '请输入输出目录路径';
                }
                return true;
            },
            filter: (input) => {
                return path.resolve(input.trim());
            }
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: '确认开始转换？',
            default: true
        }
    ];

    try {
        const answers = await inquirer.prompt(questions);
        
        if (!answers.confirm) {
            console.log('❌ 用户取消转换');
            return null;
        }

        return {
            inputDir: answers.inputDir,
            outputDir: answers.outputDir
        };
    } catch (error) {
        console.error('❌ 选择路径时出错:', error.message);
        return null;
    }
}

/**
 * 主函数
 */
async function main() {
    // 获取命令行参数
    const args = process.argv.slice(2);
    
    // 如果提供了命令行参数，使用命令行模式
    if (args.length >= 2) {
        const inputDir = path.resolve(args[0]);
        const outputDir = path.resolve(args[1]);

        console.log(`📂 输入目录: ${inputDir}`);
        console.log(`📂 输出目录: ${outputDir}\n`);

        // 创建转换器并开始转换
        const converter = new DocxToMdConverter();
        const success = converter.convert(inputDir, outputDir);

        process.exit(success ? 0 : 1);
    } else {
        // 使用交互式模式
        console.log('📖 使用方法:');
        console.log('   交互式模式: node docx_to_md_converter.js');
        console.log('   命令行模式: node docx_to_md_converter.js <输入目录> <输出目录>');
        console.log('');

        const paths = await askForPaths();
        
        if (!paths) {
            process.exit(1);
        }

        console.log(`\n📂 输入目录: ${paths.inputDir}`);
        console.log(`📂 输出目录: ${paths.outputDir}\n`);

        // 创建转换器并开始转换
        const converter = new DocxToMdConverter();
        const success = converter.convert(paths.inputDir, paths.outputDir);

        process.exit(success ? 0 : 1);
    }
}

// 如果直接运行此脚本，则执行主函数
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 程序执行出错:', error.message);
        process.exit(1);
    });
}

module.exports = DocxToMdConverter;
