const fs = require('fs');
const path = require('path');

class TokenCounter {
    constructor() {
        this.tokenCounts = {
            total: 0,
            requests: [],
            daily: {},
            modelStats: {}
        };
        this.logFile = null;
    }

    /**
     * 设置日志文件路径
     */
    setLogFile(logFilePath) {
        this.logFile = logFilePath;
        this.ensureLogDirectory();
    }

    /**
     * 确保日志目录存在
     */
    ensureLogDirectory() {
        if (this.logFile) {
            const logDir = path.dirname(this.logFile);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
        }
    }

    /**
     * 计算文本的token数量（估算）
     * 注意：这是估算值，实际值需要调用API获取
     */
    estimateTokenCount(text, model = 'gpt-3.5-turbo') {
        if (!text) return 0;
        
        // 不同模型的token计算规则
        const rules = {
            'gpt-3.5-turbo': {
                charsPerToken: 4, // 平均4个字符=1个token
                maxTokens: 4096
            },
            'gpt-4': {
                charsPerToken: 4,
                maxTokens: 8192
            },
            'gpt-4-turbo': {
                charsPerToken: 4,
                maxTokens: 128000
            },
            'claude-3-opus': {
                charsPerToken: 3.5,
                maxTokens: 200000
            },
            'claude-3-sonnet': {
                charsPerToken: 3.5,
                maxTokens: 200000
            },
            'claude-3-haiku': {
                charsPerToken: 3.5,
                maxTokens: 200000
            }
        };

        const rule = rules[model] || rules['gpt-3.5-turbo'];
        const estimatedTokens = Math.ceil(text.length / rule.charsPerToken);
        
        return Math.min(estimatedTokens, rule.maxTokens);
    }

    /**
     * 记录API调用的token使用情况
     */
    recordTokenUsage(requestData) {
        const {
            model,
            provider,
            inputTokens,
            outputTokens,
            timestamp = new Date().toISOString(),
            success = true,
            error = null,
            retryCount = 0
        } = requestData;

        const totalTokens = inputTokens + outputTokens;
        
        // 记录请求详情
        const requestRecord = {
            timestamp,
            model,
            provider,
            inputTokens,
            outputTokens,
            totalTokens,
            success,
            error,
            retryCount
        };

        this.tokenCounts.requests.push(requestRecord);
        this.tokenCounts.total += totalTokens;

        // 按模型统计
        if (!this.tokenCounts.modelStats[model]) {
            this.tokenCounts.modelStats[model] = {
                totalRequests: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalTokens: 0,
                successCount: 0,
                errorCount: 0,
                retryCount: 0
            };
        }

        const modelStats = this.tokenCounts.modelStats[model];
        modelStats.totalRequests++;
        modelStats.totalInputTokens += inputTokens;
        modelStats.totalOutputTokens += outputTokens;
        modelStats.totalTokens += totalTokens;
        
        if (success) {
            modelStats.successCount++;
        } else {
            modelStats.errorCount++;
        }
        
        modelStats.retryCount += retryCount;

        // 按日期统计
        const date = timestamp.split('T')[0];
        if (!this.tokenCounts.daily[date]) {
            this.tokenCounts.daily[date] = {
                totalTokens: 0,
                requests: 0,
                models: {}
            };
        }

        this.tokenCounts.daily[date].totalTokens += totalTokens;
        this.tokenCounts.daily[date].requests++;

        if (!this.tokenCounts.daily[date].models[model]) {
            this.tokenCounts.daily[date].models[model] = 0;
        }
        this.tokenCounts.daily[date].models[model] += totalTokens;

        // 保存到日志文件
        this.saveToLog(requestRecord);
    }

    /**
     * 保存token使用记录到日志文件
     */
    saveToLog(record) {
        if (!this.logFile) return;

        try {
            const logEntry = {
                timestamp: record.timestamp,
                model: record.model,
                provider: record.provider,
                inputTokens: record.inputTokens,
                outputTokens: record.outputTokens,
                totalTokens: record.totalTokens,
                success: record.success,
                error: record.error,
                retryCount: record.retryCount
            };

            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(this.logFile, logLine);
        } catch (error) {
            console.error('保存token日志失败:', error.message);
        }
    }

    /**
     * 获取token使用统计
     */
    getTokenStats() {
        return {
            total: this.tokenCounts.total,
            totalRequests: this.tokenCounts.requests.length,
            modelStats: this.tokenCounts.modelStats,
            dailyStats: this.tokenCounts.daily,
            averageTokensPerRequest: this.tokenCounts.requests.length > 0 
                ? Math.round(this.tokenCounts.total / this.tokenCounts.requests.length) 
                : 0
        };
    }

    /**
     * 获取指定模型的统计信息
     */
    getModelStats(model) {
        return this.tokenCounts.modelStats[model] || null;
    }

    /**
     * 获取今日token使用量
     */
    getTodayStats() {
        const today = new Date().toISOString().split('T')[0];
        return this.tokenCounts.daily[today] || {
            totalTokens: 0,
            requests: 0,
            models: {}
        };
    }

    /**
     * 重置统计
     */
    resetStats() {
        this.tokenCounts = {
            total: 0,
            requests: [],
            daily: {},
            modelStats: {}
        };
    }

    /**
     * 导出统计报告
     */
    exportReport(outputPath) {
        try {
            const report = {
                generatedAt: new Date().toISOString(),
                summary: this.getTokenStats(),
                detailedRequests: this.tokenCounts.requests
            };

            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
            return true;
        } catch (error) {
            console.error('导出报告失败:', error.message);
            return false;
        }
    }

    /**
     * 格式化token数量显示
     */
    formatTokenCount(count) {
        if (count >= 1000000) {
            return `${(count / 1000000).toFixed(2)}M`;
        } else if (count >= 1000) {
            return `${(count / 1000).toFixed(2)}K`;
        } else {
            return count.toString();
        }
    }

    /**
     * 计算成本估算（基于OpenAI定价）
     */
    estimateCost(inputTokens, outputTokens, model = 'gpt-3.5-turbo') {
        const pricing = {
            'gpt-3.5-turbo': {
                input: 0.0015,  // 每1K tokens
                output: 0.002
            },
            'gpt-4': {
                input: 0.03,
                output: 0.06
            },
            'gpt-4-turbo': {
                input: 0.01,
                output: 0.03
            }
        };

        const price = pricing[model] || pricing['gpt-3.5-turbo'];
        const inputCost = (inputTokens / 1000) * price.input;
        const outputCost = (outputTokens / 1000) * price.output;
        
        return {
            inputCost: inputCost.toFixed(4),
            outputCost: outputCost.toFixed(4),
            totalCost: (inputCost + outputCost).toFixed(4)
        };
    }
}

module.exports = TokenCounter;
