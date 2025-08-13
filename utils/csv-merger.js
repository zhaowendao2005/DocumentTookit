const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const FileUtils = require('./file-utils');
const Papa = require('papaparse');
const CsvMetadataUtils = require('./csv-metadata');

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
      this.logger.warn('未找到任何CSV文件');
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
      this.logger.info(`CSV合并完成: ${outputFileName}`);
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
      this.logger.warn('没有CSV文件可合并');
      return false;
    }

    const allRows = [];
    let headerRow = null;
    let rowCounter = 1;

    this.logger.info(`开始合并 ${csvFiles.length} 个CSV文件...`);

    for (const csvFile of csvFiles) {
      try {
        const content = await FileUtils.readFile(csvFile);
        // 使用 Papa 解析，正确处理引号/逗号/换行
        const parsed = Papa.parse(content, { header: false, skipEmptyLines: false, error: () => {} });
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) continue;

        // 若首行是元数据行，则跳过
        let dataStart = 0;
        if (CsvMetadataUtils.isMetadataRow(rows[0])) {
          dataStart = 1;
        }

        const currentHeader = rows[dataStart] || [];
        if (!headerRow) {
          headerRow = currentHeader;
          allRows.push(headerRow);
        } else {
          if (JSON.stringify(currentHeader) !== JSON.stringify(headerRow)) {
            this.logger.warn(`文件 ${path.basename(csvFile)} 的表头与第一个文件不一致，跳过表头行`);
          }
        }

        for (let i = dataStart + 1; i < rows.length; i++) {
          const row = Array.isArray(rows[i]) ? rows[i] : [rows[i]];
          if (row.length === headerRow.length && row.some(cell => String(cell).trim())) {
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
        const csvContent = Papa.unparse(allRows, { quotes: true, quoteChar: '"', escapeChar: '"' });
        this.ensureDir(path.dirname(outputPath));
        await FileUtils.writeFile(outputPath, csvContent, 'utf8');
        this.logger.info(`合并完成: ${path.basename(outputPath)} (共 ${allRows.length - 1} 行数据)`);
        return true;
      } catch (error) {
        this.logger.error(`写入合并文件失败: ${error.message}`);
        return false;
      }
    } else {
      this.logger.warn('没有有效数据可合并');
      return false;
    }
  }

  /**
   * 逐文件原样拼接（verbatim）：保留各文件的元数据行与表头，不统一表头、不重编号。
   * 返回 rows（二维数组）。
   */
  async concatCsvFilesVerbatim(csvFiles, { insertBlankLineBetweenBlocks = true } = {}) {
    const allRows = [];
    let first = true;
    for (const csvFile of csvFiles) {
      try {
        const content = await FileUtils.readFile(csvFile);
        const parsed = Papa.parse(content, { header: false, skipEmptyLines: false, error: () => {} });
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) continue;
        if (!first && insertBlankLineBetweenBlocks) {
          allRows.push([]); // 空行分隔
        }
        for (const r of rows) allRows.push(Array.isArray(r) ? r : [r]);
        first = false;
      } catch (e) {
        this.logger.error(`读取文件失败: ${path.basename(csvFile)} - ${e.message}`);
      }
    }
    return allRows;
  }

  /**
   * 去除各文件元数据行但保留表头与数据，逐文件拼接
   */
  async concatCsvFilesNoMeta(csvFiles, { insertBlankLineBetweenBlocks = true, marker = '[META]' } = {}) {
    const allRows = [];
    let first = true;
    for (const csvFile of csvFiles) {
      try {
        const content = await FileUtils.readFile(csvFile);
        const parsed = Papa.parse(content, { header: false, skipEmptyLines: false, error: () => {} });
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) continue;
        let start = 0;
        if (CsvMetadataUtils.isMetadataRow(rows[0], marker)) start = 1;
        if (!first && insertBlankLineBetweenBlocks) allRows.push([]);
        for (let i = start; i < rows.length; i++) {
          const r = Array.isArray(rows[i]) ? rows[i] : [rows[i]];
          allRows.push(r);
        }
        first = false;
      } catch (e) {
        this.logger.error(`读取文件失败: ${path.basename(csvFile)} - ${e.message}`);
      }
    }
    return allRows;
  }
  /**
   * 直接返回合并后的 rows（供后续写两个版本和 xlsx）
   */
  async mergeCsvFilesToRows(csvFiles) {
    const allRows = [];
    let headerRow = null;
    let rowCounter = 1;
    for (const csvFile of csvFiles) {
      try {
        const content = await FileUtils.readFile(csvFile);
        const parsed = Papa.parse(content, { header: false, skipEmptyLines: false, error: () => {} });
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) continue;
        let dataStart = 0;
        if (CsvMetadataUtils.isMetadataRow(rows[0])) dataStart = 1;
        const currentHeader = rows[dataStart] || [];
        if (!headerRow) {
          headerRow = currentHeader;
          allRows.push(headerRow);
        }
        for (let i = dataStart + 1; i < rows.length; i++) {
          const row = Array.isArray(rows[i]) ? rows[i] : [rows[i]];
          if (row.length === headerRow.length && row.some(cell => String(cell).trim())) {
            if (headerRow[0] === '编号' && row[0]) {
              row[0] = rowCounter.toString();
              rowCounter++;
            }
            allRows.push(row);
          }
        }
      } catch (e) {
        this.logger.error(`处理文件 ${path.basename(csvFile)} 失败: ${e.message}`);
      }
    }
    return allRows;
  }

  /**
   * 写出带合并级元数据行的 CSV
   */
  async writeMergedCsvWithMeta(rows, metaObj, outputPath, marker = '[META]') {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const metaString = CsvMetadataUtils.buildMetaString(metaObj, marker);
    const withMeta = CsvMetadataUtils.prependMetadataRowToRows(rows, metaString);
    const csv = Papa.unparse(withMeta, { quotes: true, quoteChar: '"', escapeChar: '"' });
    this.ensureDir(path.dirname(outputPath));
    await FileUtils.writeFile(outputPath, csv, 'utf8');
    return true;
  }

  /**
   * 写出不带元数据行的 CSV
   */
  async writeMergedCsv(rows, outputPath) {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const csv = Papa.unparse(rows, { quotes: true, quoteChar: '"', escapeChar: '"' });
    this.ensureDir(path.dirname(outputPath));
    await FileUtils.writeFile(outputPath, csv, 'utf8');
    return true;
  }

  /**
   * 导出为 XLSX：Sheet1=带元数据，Sheet2=无元数据
   */
  async exportXlsx({ withMetaRows, noMetaRows, xlsxPath, sheet1 = '带元数据', sheet2 = '无元数据' }) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const addSheet = (name, rows) => {
      const ws = wb.addWorksheet(name);
      for (const r of rows) ws.addRow(r);
    };
    if (Array.isArray(withMetaRows) && withMetaRows.length) addSheet(sheet1, withMetaRows);
    if (Array.isArray(noMetaRows) && noMetaRows.length) addSheet(sheet2, noMetaRows);
    this.ensureDir(path.dirname(xlsxPath));
    await wb.xlsx.writeFile(xlsxPath);
    return true;
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
