const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const CsvCleanerCore = require('../utils/csv-cleaner-core');

function isCsvFile(p) {
    return path.extname(p).toLowerCase() === '.csv';
}

function walkCsvFiles(targetPath) {
    const files = [];
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
        if (isCsvFile(targetPath)) files.push(targetPath);
    } else if (stat.isDirectory()) {
        const stack = [targetPath];
        while (stack.length) {
            const dir = stack.pop();
            try {
                const items = fs.readdirSync(dir);
                for (const it of items) {
                    const p = path.join(dir, it);
                    const st = fs.statSync(p);
                    if (st.isDirectory()) stack.push(p);
                    else if (st.isFile() && isCsvFile(p)) files.push(p);
                }
            } catch (_) {}
        }
    }
    return files;
}

function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function promptInputs() {
    const ans = await inquirer.prompt([
        {
            type: 'input',
            name: 'target',
            message: chalk.cyan('请输入目标路径（CSV 文件或目录）：'),
            default: process.cwd(),
            validate: (input) => {
                try {
                    const p = path.resolve(input.trim());
                    if (!fs.existsSync(p)) return chalk.red('路径不存在');
                    return true;
                } catch (e) {
                    return chalk.red('无效路径');
                }
            },
            filter: (input) => path.resolve(input.trim()),
        },
        {
            type: 'input',
            name: 'outputDir',
            message: chalk.cyan('输出目录：'),
            default: path.join(process.cwd(), 'data', 'output', 'csv_cleaned'),
            filter: (input) => path.resolve(input.trim()),
        },
        {
            type: 'confirm',
            name: 'treatCommonNull',
            message: chalk.cyan('是否将 NULL/N-A/— 等也视为空？'),
            default: false,
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow('确认开始清洗？'),
            default: true,
        },
    ]);
    if (!ans.confirm) return null;
    return ans;
}

async function runOnce({ target, outputDir, treatCommonNull }) {
    const files = walkCsvFiles(target);
    if (files.length === 0) {
        console.log(chalk.yellow('未发现任何 CSV 文件'));
        return 0;
    }

    ensureDir(outputDir);

    const report = { startedAt: new Date().toISOString(), target, outputDir, files: [], totals: { files: 0, rowsRemoved: 0 } };
    const ts = timestamp();

    for (const file of files) {
        try {
            const res = CsvCleanerCore.processFile(file, { treatCommonNull });
            const base = path.basename(file, path.extname(file));
            const outFile = path.join(outputDir, `${base}.cleaned.csv`);
            fs.writeFileSync(outFile, res.outputCsv, 'utf8');

            console.log(chalk.green(`✔ ${path.basename(file)} -> ${path.basename(outFile)}  删除 ${res.removed.length}`));
            report.files.push({ file, output: outFile, removedCount: res.removed.length, removedRows: res.removed.map(r => r.rowNumber) });
            report.totals.files += 1;
            report.totals.rowsRemoved += res.removed.length;
        } catch (e) {
            console.log(chalk.red(`✖ 处理失败: ${file} - ${e.message}`));
            report.files.push({ file, error: e.message });
        }
    }

    const reportPath = path.join(outputDir, `csv-cleaner-report-${ts}.json`);
    try { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8'); } catch(_) {}
    console.log(chalk.cyan(`报告: ${reportPath}`));
    console.log(chalk.blue(`总计：文件 ${report.totals.files} 个，删除行 ${report.totals.rowsRemoved}`));
    return report.totals.rowsRemoved;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        const ans = await promptInputs();
        if (!ans) return process.exit(1);
        const removed = await runOnce(ans);
        process.exit(removed >= 0 ? 0 : 1);
    }

    // 命令行参数：node tools/csv-cleaner.js <path> <outputDir> [--treat-null]
    const target = path.resolve(args[0]);
    const outputDir = path.resolve(args[1] || path.join(process.cwd(), 'data', 'output', 'csv_cleaned'));
    const treatCommonNull = args.includes('--treat-null');
    const removed = await runOnce({ target, outputDir, treatCommonNull });
    process.exit(removed >= 0 ? 0 : 1);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(chalk.red('运行失败:'), e && e.message ? e.message : e);
        process.exit(1);
    });
}

module.exports = { runOnce };


