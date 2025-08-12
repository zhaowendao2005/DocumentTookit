#!/usr/bin/env node

/**
 * 文本分割工具 - 独立CLI入口
 * 可以直接运行: node tools/text-splitter-cli.js
 */

const TextSplitterUI = require('../modules/text-splitter-ui');

async function main() {
    try {
        const textSplitterUI = new TextSplitterUI();
        await textSplitterUI.run();
    } catch (error) {
        console.error('❌ 文本分割工具执行失败:', error.message);
        process.exit(1);
    }
}

// 如果直接运行此文件
if (require.main === module) {
    main();
}

module.exports = { main };
