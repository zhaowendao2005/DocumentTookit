const Papa = require('papaparse');

/**
 * CSV 元数据工具
 */
class CsvMetadataUtils {
    /**
     * 构建标准化的元数据字符串
     * @param {object} metaObj 键值元数据对象
     * @param {string} marker 前缀标记，默认 [META]
     * @returns {string} 形如 "[META] key1=v1; key2=v2" 的字符串
     */
    static buildMetaString(metaObj = {}, marker = '[META]') {
        const parts = [];
        for (const [k, v] of Object.entries(metaObj)) {
            if (v === undefined || v === null) continue;
            const cleanVal = String(v).replace(/\r|\n/g, ' ').trim();
            parts.push(`${k}=${cleanVal}`);
        }
        return `${marker} ${parts.join('; ')}`.trim();
    }

    /**
     * 判断一行是否为元数据行
     * 约定：元数据行的最后一个单元格以 marker 开头
     * @param {any[]} cells CSV 行的单元格数组
     * @param {string} marker
     */
    static isMetadataRow(cells, marker = '[META]') {
        if (!Array.isArray(cells) || cells.length === 0) return false;
        const last = String(cells[cells.length - 1] ?? '').trim();
        return last.startsWith(marker);
    }

    /**
     * 在 CSV 文本前插入元数据行（自动计算表头列数）
     * @param {string} csvText 原始 CSV 文本
     * @param {string} metaString 元数据字符串（含 marker）
     * @returns {string} 插入后的 CSV 文本
     */
    static prependMetadataRowToCsv(csvText, metaString) {
        if (!csvText || !metaString) return csvText;
        const parsed = Papa.parse(csvText, { header: false, skipEmptyLines: false, error: () => {} });
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        if (rows.length === 0) return csvText;
        const header = rows[0];
        const headerLen = Array.isArray(header) ? header.length : 0;
        const metaRow = new Array(Math.max(0, headerLen)).fill('');
        metaRow.push(metaString);
        const newRows = [metaRow, ...rows];
        return Papa.unparse(newRows, { quotes: true, quoteChar: '"', escapeChar: '"' });
    }

    /**
     * 将 rows 数组写出为插入元数据行后的 rows
     * @param {any[][]} rows 二维数组（首行为表头）
     * @param {string} metaString 元数据字符串
     * @returns {any[][]}
     */
    static prependMetadataRowToRows(rows, metaString) {
        if (!Array.isArray(rows) || rows.length === 0 || !metaString) return rows;
        const header = rows[0];
        const headerLen = Array.isArray(header) ? header.length : 0;
        const metaRow = new Array(Math.max(0, headerLen)).fill('');
        metaRow.push(metaString);
        return [metaRow, ...rows];
    }
}

module.exports = CsvMetadataUtils;


