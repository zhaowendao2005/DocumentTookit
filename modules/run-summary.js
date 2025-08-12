const fs = require('fs');
const path = require('path');

class RunSummary {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  generateSummaryJson({ runId, runOutputDir, mode, stats, tokenStats }) {
    const summary = {
      runId,
      mode,
      outputDir: runOutputDir,
      totals: {
        total: stats.total,
        succeeded: stats.succeeded,
        failed: stats.failed,
        fallback: stats.fallback || 0,
      },
      files: stats.files || [],
      token: tokenStats || null,
      generatedAt: new Date().toISOString(),
    };
    return summary;
  }

  writeJson(summary, outDir) {
    const jsonPath = path.join(outDir, 'run_summary.json');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
    this.logger.info(`📄 运行总结(JSON): ${jsonPath}`);
    return jsonPath;
  }

  writeMarkdown(summary, outDir) {
    const mdPath = path.join(outDir, 'run_summary.md');
    const t = summary.totals;
    const lines = [];
    lines.push(`# 批处理运行总结（${summary.runId}）`);
    lines.push('');
    lines.push('## 总览');
    lines.push(`- 处理文件：总计 ${t.total}，成功 ${t.succeeded}，失败 ${t.failed}，回退经典 ${t.fallback}`);
    lines.push(`- 输出目录：${summary.outputDir}`);
    if (summary.token) {
      lines.push('');
      lines.push('## Token 用量');
      lines.push(`- 总请求数：${summary.token.totalRequests}`);
      lines.push(`- 总tokens：${summary.token.total}`);
      lines.push(`- 平均每请求：${summary.token.averageTokensPerRequest}`);
      lines.push(`- 真实用量记录数：${summary.token.apiResponseCount} | 估算：${summary.token.estimatedCount}`);
    }
    if (summary.files && summary.files.length) {
      lines.push('');
      lines.push('## 文件结果');
      lines.push('| 文件 | 模式 | 成功 | 回退 | 纠错回合 | 错误 |');
      lines.push('|---|---|---:|---:|---:|---|');
      for (const f of summary.files) {
        lines.push(`| ${f.filename} | ${f.mode || '-'} | ${f.succeeded ? '✅' : '❌'} | ${f.fallback ? '🟡' : ''} | ${f.repairAttemptsUsed ?? '-'} | ${f.error ? f.error : ''} |`);
      }
    }
    fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf8');
    this.logger.info(`📝 运行总结(MD): ${mdPath}`);
    return mdPath;
  }
}

module.exports = RunSummary;


