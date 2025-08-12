#!/usr/bin/env node

/**
 * 增强文件选择器测试脚本
 * 测试空格键选择和目录递归选择功能
 */
const FileSelector = require('./utils/file-selector');
const chalk = require('chalk');

async function testEnhancedSelector() {
    console.log(chalk.cyan('🧪 增强文件选择器测试\n'));
    
    const selector = new FileSelector();
    
    try {
        console.log(chalk.yellow('测试空格键多选功能:'));
        console.log(chalk.gray('功能说明:'));
        console.log(chalk.gray('- 使用 ↑↓ 键移动光标'));
        console.log(chalk.gray('- 使用 空格键 选择/取消选择文件或目录'));
        console.log(chalk.gray('- 选择目录时会自动包含该目录下的所有支持文件'));
        console.log(chalk.gray('- 使用 a 键全选，i 键反选'));
        console.log(chalk.gray('- 按回车键确认选择\n'));
        
        const files = await selector.selectFiles(
            '请使用空格键选择多个文件（支持目录递归选择）', 
            './', 
            ['.js', '.json', '.md', '.txt']
        );
        
        if (files && files.length > 0) {
            console.log(chalk.green(`\n🎉 测试成功！选择了 ${files.length} 个文件:`));
            files.forEach((file, index) => {
                console.log(chalk.green(`  ${index + 1}. ${file}`));
            });
        } else {
            console.log(chalk.yellow('📝 未选择任何文件'));
        }
        
    } catch (error) {
        console.error(chalk.red(`❌ 测试失败: ${error.message}`));
    }
}

// 仅在直接运行时执行测试
if (require.main === module) {
    testEnhancedSelector().catch(console.error);
}

module.exports = testEnhancedSelector;
