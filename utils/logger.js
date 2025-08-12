const fs = require('fs');
const path = require('path');

class Logger {
    constructor(options = {}) {
        this.logLevel = options.logLevel || 'info';
        this.logFile = options.logFile || null;
        this.consoleOutput = options.consoleOutput !== false;
        
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    /**
     * 记录错误日志
     * @param {string} message - 日志消息
     * @param {Error} error - 错误对象
     */
    error(message, error = null) {
        this.log('error', message, error);
    }

    /**
     * 记录警告日志
     * @param {string} message - 日志消息
     */
    warn(message) {
        this.log('warn', message);
    }

    /**
     * 记录信息日志
     * @param {string} message - 日志消息
     */
    info(message) {
        this.log('info', message);
    }

    /**
     * 记录调试日志
     * @param {string} message - 日志消息
     */
    debug(message) {
        this.log('debug', message);
    }

    /**
     * 记录日志
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Error} error - 错误对象
     */
    log(level, message, error = null) {
        if (this.levels[level] > this.levels[this.logLevel]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp: timestamp,
            level: level.toUpperCase(),
            message: message,
            error: error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
            } : null
        };

        const logString = this.formatLogEntry(logEntry);

        // 控制台输出
        if (this.consoleOutput) {
            this.writeToConsole(logEntry);
        }

        // 文件输出
        if (this.logFile) {
            this.writeToFile(logString);
        }
    }

    /**
     * 格式化日志条目
     * @param {Object} logEntry - 日志条目
     * @returns {string} 格式化的日志字符串
     */
    formatLogEntry(logEntry) {
        let logString = `[${logEntry.timestamp}] ${logEntry.level}: ${logEntry.message}`;
        
        if (logEntry.error) {
            logString += `\nError: ${logEntry.error.name}: ${logEntry.error.message}`;
            if (logEntry.error.stack) {
                logString += `\nStack: ${logEntry.error.stack}`;
            }
        }
        
        return logString + '\n';
    }

    /**
     * 写入控制台
     * @param {Object} logEntry - 日志条目
     */
    writeToConsole(logEntry) {
        const colors = {
            error: '\x1b[31m', // 红色
            warn: '\x1b[33m',  // 黄色
            info: '\x1b[36m',  // 青色
            debug: '\x1b[37m'  // 白色
        };
        
        const reset = '\x1b[0m';
        const color = colors[logEntry.level.toLowerCase()] || '';
        
        console.log(`${color}[${logEntry.level}]${reset} ${logEntry.message}`);
        
        if (logEntry.error) {
            console.error(`${color}Error:${reset} ${logEntry.error.name}: ${logEntry.error.message}`);
        }
    }

    /**
     * 写入文件
     * @param {string} logString - 日志字符串
     */
    writeToFile(logString) {
        try {
            // 确保日志目录存在
            const logDir = path.dirname(this.logFile);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            fs.appendFileSync(this.logFile, logString);
        } catch (error) {
            console.error('写入日志文件失败:', error.message);
        }
    }

    /**
     * 创建进度日志
     * @param {string} task - 任务名称
     * @param {number} current - 当前进度
     * @param {number} total - 总数
     */
    progress(task, current, total) {
        const percentage = Math.round((current / total) * 100);
        const progressBar = this.createProgressBar(percentage);
        
        this.info(`${task}: ${progressBar} ${current}/${total} (${percentage}%)`);
    }

    /**
     * 创建进度条
     * @param {number} percentage - 百分比
     * @returns {string} 进度条字符串
     */
    createProgressBar(percentage) {
        const width = 20;
        const filled = Math.round((percentage / 100) * width);
        const empty = width - filled;
        
        const filledChar = '█';
        const emptyChar = '░';
        
        return filledChar.repeat(filled) + emptyChar.repeat(empty);
    }

    /**
     * 创建文件日志记录器
     * @param {string} logFile - 日志文件路径
     * @returns {Logger} 日志记录器实例
     */
    static createFileLogger(logFile) {
        return new Logger({
            logFile: logFile,
            consoleOutput: true,
            logLevel: 'info'
        });
    }

    /**
     * 创建控制台日志记录器
     * @returns {Logger} 日志记录器实例
     */
    static createConsoleLogger() {
        return new Logger({
            consoleOutput: true,
            logLevel: 'info'
        });
    }
}

module.exports = Logger;
