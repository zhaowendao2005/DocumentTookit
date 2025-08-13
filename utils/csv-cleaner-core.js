const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

/**
 * CSV 清洗核心：删除第三列为空的行（保留表头）。
 * - 第三列按索引 2 判断；首行被视为表头，无条件保留
 * - 空值判定：去除空白字符（含全角空格）后长度为 0
 */
class CsvCleanerCore {
    /**
     * 清洗 CSV 文本内容
     * @param {string} csvContent 原始CSV文本
     * @param {object} [options]
     * @param {boolean} [options.treatCommonNull=false] 是否将"NULL"、"N/A"、"—"等视为空
     * @returns {{ header: string[]|null, keptRows: any[][], removed: Array<{rowNumber:number, sample:string}> }}
     */
    static cleanCsvContent(csvContent, options = {}) {
        const treatCommonNull = options.treatCommonNull === true;

        // 使用 Papa 解析，避免引号/逗号/换行陷阱
        const parsed = Papa.parse(csvContent, {
            header: false,
            skipEmptyLines: false,
            error: () => {},
        });

        // 容错：解析失败返回空处理
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) {
            return { header: null, keptRows: [], removed: [] };
        }

        const header = rows[0];
        const keptRows = [header];
        const removed = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            // 容错：确保为数组
            const fields = Array.isArray(row) ? row : [row];
            const v = (fields[2] ?? '').toString();
            const normalized = CsvCleanerCore.normalizeWhitespace(v);
            const isCommonNull = treatCommonNull && CsvCleanerCore.isCommonNullLike(normalized);
            const isEmpty = (normalized.length === 0) || isCommonNull;

            if (isEmpty) {
                removed.push({ rowNumber: i + 1, sample: v.length > 120 ? (v.slice(0, 120) + '…') : v });
                continue;
            }
            keptRows.push(fields);
        }

        return { header, keptRows, removed };
    }

    /**
     * 处理单个文件：读取→清洗→返回结果（是否写出由调用方决定）
     * @param {string} filePath 输入CSV文件路径
     * @param {object} [options]
     * @returns {{ header: string[]|null, keptRows: any[][], removed: Array<{rowNumber:number, sample:string}>, originalCount:number, outputCsv:string }}
     */
    static processFile(filePath, options = {}) {
        const content = fs.readFileSync(filePath, 'utf8');
        const { header, keptRows, removed } = CsvCleanerCore.cleanCsvContent(content, options);
        const outputCsv = CsvCleanerCore.unparseCsv(keptRows);
        return { header, keptRows, removed, originalCount: keptRows.length + removed.length - 1, outputCsv };
    }

    /**
     * 将二维数组导出为CSV文本（统一转义）
     */
    static unparseCsv(rows) {
        if (!rows || rows.length === 0) return '';
        return Papa.unparse(rows, {
            quotes: true,
            quoteChar: '"',
            escapeChar: '"',
        });
    }

    /**
     * 规范化空白：移除全角空格并 trim
     */
    static normalizeWhitespace(s) {
        if (s == null) return '';
        return s.replace(/\u3000/g, ' ').trim();
    }

    /**
     * 常见空值字面量判定
     */
    static isCommonNullLike(s) {
        const v = s.trim().toLowerCase();
        return v === 'null' || v === 'n/a' || v === 'na' || v === '-' || v === '—' || v === '--';
    }
}

module.exports = CsvCleanerCore;


