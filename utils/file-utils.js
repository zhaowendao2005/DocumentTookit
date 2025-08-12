const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

class FileUtils {
    /**
     * 扫描目录中的文件
     * @param {string} directory - 目录路径
     * @param {Array} extensions - 支持的文件扩展名
     * @returns {Array} 文件列表
     */
    static async scanFiles(directory, extensions = ['.txt', '.md', '.docx']) {
        const files = [];
        
        const scanDir = async (dir) => {
            try {
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    
                    if (stat.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (this.isSupportedFile(item, extensions)) {
                        files.push({
                            path: fullPath,
                            name: item,
                            size: stat.size,
                            modified: stat.mtime,
                            relativePath: path.relative(directory, fullPath)
                        });
                    }
                }
            } catch (error) {
                console.error(`扫描目录失败: ${dir}`, error.message);
            }
        };

        await scanDir(directory);
        return files;
    }

    /**
     * 检查文件是否支持
     * @param {string} filename - 文件名
     * @param {Array} extensions - 支持的文件扩展名
     * @returns {boolean} 是否支持
     */
    static isSupportedFile(filename, extensions = ['.txt', '.md', '.docx']) {
        const ext = path.extname(filename).toLowerCase();
        return extensions.includes(ext);
    }

    /**
     * 读取文件内容
     * @param {string} filePath - 文件路径
     * @returns {Promise<string>} 文件内容
     */
    static async readFile(filePath) {
        try {
            const ext = path.extname(filePath).toLowerCase();
            
            switch (ext) {
                case '.txt':
                case '.md':
                    return fs.readFileSync(filePath, 'utf8');
                    
                case '.docx':
                    return await this.convertDocxToText(filePath);
                    
                default:
                    throw new Error(`不支持的文件格式: ${ext}`);
            }
        } catch (error) {
            throw new Error(`读取文件失败: ${filePath} - ${error.message}`);
        }
    }

    /**
     * 转换DOCX文件为文本
     * @param {string} filePath - DOCX文件路径
     * @returns {Promise<string>} 转换后的文本
     */
    static async convertDocxToText(filePath) {
        try {
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;
        } catch (error) {
            throw new Error(`DOCX转换失败: ${error.message}`);
        }
    }

    /**
     * 写入文件
     * @param {string} filePath - 文件路径
     * @param {string} content - 文件内容
     * @param {string} encoding - 编码格式
     */
    static writeFile(filePath, content, encoding = 'utf8') {
        try {
            // 确保目录存在
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(filePath, content, encoding);
        } catch (error) {
            throw new Error(`写入文件失败: ${filePath} - ${error.message}`);
        }
    }

    /**
     * 解析CSV内容
     * @param {string} csvContent - CSV内容
     * @returns {Array} 解析后的数据
     */
    static parseCSV(csvContent) {
        const lines = csvContent.trim().split('\n');
        return lines.map(line => {
            const fields = [];
            let currentField = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    fields.push(currentField.trim());
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            
            fields.push(currentField.trim());
            return fields;
        });
    }

    /**
     * 数组转CSV
     * @param {Array} data - 数据数组
     * @returns {string} CSV字符串
     */
    static arrayToCSV(data) {
        return data.map(row => 
            row.map(field => `"${field}"`).join(',')
        ).join('\n');
    }

    /**
     * 获取文件大小的人类可读格式
     * @param {number} bytes - 字节数
     * @returns {string} 格式化的大小
     */
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 创建输出文件名
     * @param {string} inputPath - 输入文件路径
     * @param {string} suffix - 后缀
     * @param {string} extension - 扩展名
     * @returns {string} 输出文件路径
     */
    static createOutputFileName(inputPath, suffix = '', extension = '.csv') {
        const dir = path.dirname(inputPath);
        const name = path.basename(inputPath, path.extname(inputPath));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        
        return path.join(dir, `${name}${suffix}_${timestamp}${extension}`);
    }

    /**
     * 读取目录内容
     * @param {string} dir - 目录路径
     * @returns {Promise<Array>} 目录内容列表
     */
    static async readDir(dir) {
        return new Promise((resolve, reject) => {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(files);
                }
            });
        });
    }

    /**
     * 获取文件状态
     * @param {string} filePath - 文件路径
     * @returns {Promise<Object>} 文件状态对象
     */
    static async getStat(filePath) {
        return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stats);
                }
            });
        });
    }
}

module.exports = FileUtils;
