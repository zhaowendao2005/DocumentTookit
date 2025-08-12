/**
 * 增强的文件选择器
 * 使用原生inquirer checkbox，添加目录递归选择功能
 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');

/**
 * 创建增强的checkbox提示
 * @param {Object} options 选项
 * @returns {Promise} 选择结果
 */
async function checkboxPlus(options) {
    const { choices, message, pageSize = 15 } = options;
    
    // 使用原生checkbox
    const answer = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selections',
        message: message + chalk.dim('\n(使用 ↑↓ 移动, 空格 选择, a 全选, i 反选, 回车 确认)'),
        choices: choices,
        pageSize: pageSize
    }]);
    
    return answer.selections;
}

module.exports = checkboxPlus;
