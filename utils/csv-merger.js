const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const FileUtils = require('./file-utils');

/**
 * CSV合并工具
 */
class CsvMerger {
  constructor(logger = console) {
    this.logger = logger;
  }

  /**
   * 交互式合并CSV文件
   * @param {string} inputDir - 输入目录
   * @param {string} outputDir - 输出目录
   */
  async mergeCsvFilesInteractive(inputDir, outputDir) {
    const csvFiles = await this.findCsvFiles(inputDir);
    
    if (csvFiles.length === 0) {
      this.logger.warning('未找到任何CSV文件');
      return false;
    }

    if (csvFiles.length === 1) {
      this.logger.info('只找到一个CSV文件，无需合并');
      return false;
    }

    console.log(chalk.cyan(`\n📊 发现 ${csvFiles.length} 个CSV文件`));
    console.log(chalk.gray('文件列表:'));
    csvFiles.forEach((file, index) => {
      console.log(chalk.gray(`  ${index + 1}. ${path.basename(file)}`));
    });

    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'merge',
        message: chalk.yellow('是否合并所有CSV文件？'),
        default: true
      }
    ]);

    if (!answer.merge) {
      this.logger.info('用户取消合并操作');
      return false;
    }

    // 生成输出文件名
    const timestamp = this.formatLocalTimestamp();
    const outputFileName = `merged_${timestamp}.csv`;
    const outputPath = path.join(outputDir, outputFileName);

    const success = await this.mergeCsvFiles(csvFiles, outputPath);
    
    if (success) {
      this.logger.success(`CSV合并完成: ${outputFileName}`);
      return true;
    } else {
      this.logger.error('CSV合并失败');
      return false;
    }
  }

  /**
   * 查找目录中的所有CSV文件
   * @param {string} dir - 目录路径
   * @returns {Promise<string[]>} CSV文件路径列表
   */
  async findCsvFiles(dir) {
    const files = [];
    
    try {
      const items = await FileUtils.readDir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await FileUtils.getStat(fullPath);
        
        if (stat.isDirectory()) {
          const subFiles = await this.findCsvFiles(fullPath);
          files.push(...subFiles);
        } else if (path.extname(item).toLowerCase() === '.csv') {
          files.push(fullPath);
        }
      }
    } catch (error) {
      this.logger.error(`读取目录失败: ${error.message}`);
    }
    
    return files;
  }

  /**
   * 合并多个CSV文件为一个
   * @param {string[]} csvFiles - CSV文件路径列表
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<boolean>} 是否成功
   */
  async mergeCsvFiles(csvFiles, outputPath) {
    if (csvFiles.length === 0) {
      this.logger.warning('没有CSV文件可合并');
      return false;
    }

    const allRows = [];
    let headerRow = null;
    let rowCounter = 1;

    this.logger.info(`开始合并 ${csvFiles.length} 个CSV文件...`);

    for (const csvFile of csvFiles) {
      try {
        const content = await FileUtils.readFile(csvFile);
        const lines = content.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) continue;

        // 解析CSV行（简单处理，假设没有复杂的引号嵌套）
        const parseCsvLine = (line) => {
          return line.split(',').map(field => field.trim().replace(/^"|"$/g, ''));
        };

        // 第一行作为表头（如果还没有表头）
        if (!headerRow) {
          headerRow = parseCsvLine(lines[0]);
          allRows.push(headerRow);
        } else {
          // 检查表头是否一致
          const currentHeader = parseCsvLine(lines[0]);
          if (JSON.stringify(currentHeader) !== JSON.stringify(headerRow)) {
            this.logger.warning(`文件 ${path.basename(csvFile)} 的表头与第一个文件不一致，跳过表头行`);
          }
        }

        // 添加数据行（跳过表头行）
        for (let i = 1; i < lines.length; i++) {
          const row = parseCsvLine(lines[i]);
          if (row.length === headerRow.length && row.some(cell => cell.trim())) {
            // 如果第一列是编号，重新编号；否则保持原样
            if (headerRow[0] === '编号' && row[0]) {
              row[0] = rowCounter.toString();
              rowCounter++;
            }
            allRows.push(row);
          }
        }

        this.logger.info(`已处理: ${path.basename(csvFile)}`);
      } catch (error) {
        this.logger.error(`处理文件 ${path.basename(csvFile)} 失败: ${error.message}`);
      }
    }

    // 写入合并后的CSV文件
    if (allRows.length > 1) { // 至少有表头+1行数据
      try {
        const csvContent = allRows.map(row => 
          row.map(field => `"${field.replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // 确保输出目录存在
        this.ensureDir(path.dirname(outputPath));
        
        await FileUtils.writeFile(outputPath, csvContent, 'utf8');
        this.logger.success(`合并完成: ${path.basename(outputPath)} (共 ${allRows.length - 1} 行数据)`);
        return true;
      } catch (error) {
        this.logger.error(`写入合并文件失败: ${error.message}`);
        return false;
      }
    } else {
      this.logger.warning('没有有效数据可合并');
      return false;
    }
  }

  /**
   * 生成东八区本地时间戳（YYYY-MM-DDTHH-mm-ss）
   */
  formatLocalTimestamp(timeZone = 'Asia/Shanghai') {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}`;
  }

  /**
   * 确保目录存在
   */
  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = CsvMerger;
