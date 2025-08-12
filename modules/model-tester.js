const chalk = require('chalk');
const ora = require('ora');
const LLMClient = require('./llm-client');
const TokenCounter = require('../utils/token-counter');

/**
 * 模型测试器：测试LLM模型的可用性和响应质量
 */
class ModelTester {
    constructor(config) {
        this.config = config;
        this.client = new LLMClient({ 
            providers: config.providers, 
            retry: { ...config.retry, max_retry_count: 1 } // 测试时减少重试次数
        });
        this.tokenCounter = new TokenCounter();
        
        if (config.token_tracking?.save_token_logs && config.token_tracking?.log_file) {
            this.tokenCounter.setLogFile(config.token_tracking.log_file);
        }
    }

    /**
     * 执行模型测试
     * @param {Object} testConfig - 测试配置
     */
    async runTest(testConfig) {
        const { testType, testPrompt, timeout, connectTimeout } = testConfig;
        
        console.log(chalk.cyan('\n🧪 开始模型测试...\n'));
        console.log(chalk.gray(`测试提示词: ${testPrompt}`));
        console.log(chalk.gray(`连接超时: ${(connectTimeout ?? (this.config.network?.connect_timeout_ms || 3000))}ms`));
        console.log(chalk.gray(`响应超时: ${(timeout ?? (this.config.network?.response_timeout_ms || 60000))}ms\n`));

        let modelsToTest = [];

        switch (testType) {
            case 'single':
                modelsToTest = [testConfig.model];
                break;
            case 'provider':
                const provider = this.config.providers.find(p => p.name === testConfig.provider);
                if (provider) {
                    modelsToTest = provider.models.map(model => ({
                        provider: provider.name,
                        model: model
                    }));
                }
                break;
            case 'all':
                this.config.providers.forEach(provider => {
                    provider.models.forEach(model => {
                        modelsToTest.push({
                            provider: provider.name,
                            model: model
                        });
                    });
                });
                break;
        }

        if (modelsToTest.length === 0) {
            console.log(chalk.red('❌ 没有找到要测试的模型'));
            return [];
        }

        console.log(chalk.yellow(`📋 将测试 ${modelsToTest.length} 个模型:\n`));
        modelsToTest.forEach((model, index) => {
            console.log(chalk.gray(`  ${index + 1}. ${model.provider} - ${model.model}`));
        });

        const startTime = Date.now();

        // 并发触发全部测试
        const promises = modelsToTest.map((model) =>
            this.testSingleModel(
                model,
                testPrompt,
                // 响应超时（ms）
                timeout ?? (this.config.network?.response_timeout_ms || 60000),
                // 连接超时（ms）
                connectTimeout ?? (this.config.network?.connect_timeout_ms || 3000)
            )
        );

        const settled = await Promise.allSettled(promises);
        const results = settled.map((s, idx) => (s.status === 'fulfilled' ? s.value : {
            provider: modelsToTest[idx].provider,
            model: modelsToTest[idx].model,
            success: false,
            response: '',
            error: s.reason?.message || '未知错误',
            responseTime: 0,
            tokenUsage: null,
            timestamp: new Date().toISOString()
        }));

        // 并发模式下逐条展示结果（保持原顺序）
        results.forEach(r => this.displayTestResult(r));

        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);
        this.displayTestSummary(results, totalTime);
        
        return results;
    }

    /**
     * 测试单个模型
     * @param {Object} model - 模型信息 { provider, model }
     * @param {string} prompt - 测试提示词
     * @param {number} responseTimeoutMs - 响应超时(毫秒)
     * @param {number} connectTimeoutMs - 连接超时(毫秒)
     */
    async testSingleModel(model, prompt, responseTimeoutMs, connectTimeoutMs) {
        const spinner = ora(`正在测试 ${model.provider}/${model.model}...`).start();
        
        const result = {
            provider: model.provider,
            model: model.model,
            success: false,
            response: '',
            error: null,
            responseTime: 0,
            tokenUsage: null,
            timestamp: new Date().toISOString()
        };

        try {
            const startTime = Date.now();
            
            const response = await this.client.chatCompletion({
                providerName: model.provider,
                model: model.model,
                messages: [
                    { role: 'system', content: '你是一个测试助手，请简洁回复用户的问题。' },
                    { role: 'user', content: prompt }
                ],
                extra: { temperature: 0.1 },
                timeouts: {
                    connectTimeoutMs: connectTimeoutMs,
                    responseTimeoutMs: responseTimeoutMs
                }
            });

            const endTime = Date.now();
            result.responseTime = endTime - startTime;
            result.success = true;
            result.response = response.text;

            // 记录token使用情况
            const usage = this.tokenCounter.getTokenUsage(
                response.raw,
                prompt,
                response.text,
                model.model
            );
            result.tokenUsage = usage;

            this.tokenCounter.recordTokenUsage({
                model: model.model,
                provider: model.provider,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                method: usage.method,
                estimated: usage.estimated,
            });

            spinner.succeed(`测试成功: ${model.provider}/${model.model} (${result.responseTime}ms)`);
            
        } catch (error) {
            result.error = error.message;
            spinner.fail(`测试失败: ${model.provider}/${model.model} - ${error.message}`);
        }

        return result;
    }

    /**
     * 显示单个测试结果
     * @param {Object} result - 测试结果
     */
    displayTestResult(result) {
        if (result.success) {
            console.log(chalk.green(`  ✅ 响应时间: ${result.responseTime}ms`));
            if (result.tokenUsage) {
                const method = result.tokenUsage.method === 'api_response' ? '真实' : '估算';
                console.log(chalk.gray(`  📊 Token: ${result.tokenUsage.inputTokens} + ${result.tokenUsage.outputTokens} = ${result.tokenUsage.totalTokens} (${method})`));
            }
            console.log(chalk.gray(`  💬 回复: ${result.response.substring(0, 100)}${result.response.length > 100 ? '...' : ''}`));
        } else {
            console.log(chalk.red(`  ❌ 错误: ${result.error}`));
        }
    }

    /**
     * 显示测试总结
     * @param {Array} results - 所有测试结果
     * @param {string} totalTime - 总耗时
     */
    displayTestSummary(results, totalTime) {
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        
        console.log(chalk.cyan('\n📊 测试总结'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.green(`✅ 成功: ${successCount}`));
        console.log(chalk.red(`❌ 失败: ${failCount}`));
        console.log(chalk.blue(`⏱️  总耗时: ${totalTime}秒`));
        
        if (successCount > 0) {
            const avgResponseTime = results
                .filter(r => r.success)
                .reduce((sum, r) => sum + r.responseTime, 0) / successCount;
            console.log(chalk.blue(`📈 平均响应时间: ${Math.round(avgResponseTime)}ms`));
        }

        // 显示失败的模型
        if (failCount > 0) {
            console.log(chalk.red('\n❌ 失败的模型:'));
            results.filter(r => !r.success).forEach(r => {
                console.log(chalk.red(`  • ${r.provider} - ${r.model}: ${r.error}`));
            });
        }

        // 显示成功的模型
        if (successCount > 0) {
            console.log(chalk.green('\n✅ 成功的模型:'));
            results.filter(r => r.success).forEach(r => {
                console.log(chalk.green(`  • ${r.provider} - ${r.model} (${r.responseTime}ms)`));
            });
        }
    }

    /**
     * 导出测试报告
     * @param {Array} results - 测试结果
     * @param {string} outputPath - 输出路径
     */
    exportTestReport(results, outputPath) {
        try {
            const report = {
                generatedAt: new Date().toISOString(),
                summary: {
                    total: results.length,
                    success: results.filter(r => r.success).length,
                    failed: results.filter(r => !r.success).length
                },
                results: results
            };

            require('fs').writeFileSync(outputPath, JSON.stringify(report, null, 2));
            console.log(chalk.green(`\n📄 测试报告已导出: ${outputPath}`));
            return true;
        } catch (error) {
            console.error(chalk.red(`❌ 导出报告失败: ${error.message}`));
            return false;
        }
    }
}

module.exports = ModelTester;
