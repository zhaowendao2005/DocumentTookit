#!/usr/bin/env node

/**
 * 文本分割工具 - 独立CLI入口
 * 可以直接运行: node tools/text-splitter-cli.js
 */

const TextSplitterUI = require('../modules/text-splitter-ui');
const ConfigLoader = require('../config/config-loader');

async function main() {
    try {
        // 尝试加载配置文件
        let config = {};
        try {
            config = await ConfigLoader.load();
            console.log('✅ 配置文件加载成功');
        } catch (error) {
            console.log('⚠️  配置文件加载失败，使用默认配置');
            config = {};
        }
        
        const textSplitterUI = new TextSplitterUI(config);
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
