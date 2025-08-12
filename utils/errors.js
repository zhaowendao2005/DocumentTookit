const fs = require('fs');
const path = require('path');

/**
 * 错误分类与规范化工具
 * - 将 HTTP/网络/业务阶段错误统一映射为 { type, message, status, code }
 * - 尽量不依赖外部库，保持可移植性
 */
class ErrorClassifier {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.knownTypes]
   */
  constructor(options = {}) {
    this.knownTypes = options.knownTypes || [
      'network_error',
      'timeout',
      'rate_limit',
      'server_error',
      'client_error',
      'parse_error',
      'validation_error',
      'fallback_failed',
      'write_error',
      'unsupported_file',
      'unknown_error',
    ];
  }

  /**
   * 依据异常对象与上下文进行分类
   * @param {any} err - 捕获的异常
   * @param {Object} [context]
   * @param {string} [context.stage] - request|parse|validation|write|fallback
   * @returns {{ type:string, message:string, status?:number, code?:string }}
   */
  classify(err, context = {}) {
    const stage = context.stage;

    // 直接指定业务阶段错误类型
    if (stage === 'parse') return this._normalize('parse_error', err);
    if (stage === 'validation') return this._normalize('validation_error', err);
    if (stage === 'write') return this._normalize('write_error', err);
    if (stage === 'fallback') return this._normalize('fallback_failed', err);

    // 具备 axios 风格的错误
    const anyErr = err || {};
    const code = anyErr.code || (anyErr.cause && anyErr.cause.code) || undefined;
    const message = (anyErr.message && String(anyErr.message)) || String(anyErr);

    // 网络/超时
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET') {
      return this._normalize('network_error', { message, code });
    }
    if (code === 'ECONNABORTED' || /timeout/i.test(message)) {
      return this._normalize('timeout', { message, code });
    }

    // HTTP 响应错误
    if (anyErr.response && typeof anyErr.response.status === 'number') {
      const status = anyErr.response.status;
      if (status === 429) return this._normalize('rate_limit', { message: this._reason(anyErr), status });
      if (status >= 500) return this._normalize('server_error', { message: this._reason(anyErr), status });
      if (status >= 400) return this._normalize('client_error', { message: this._reason(anyErr), status });
    }

    // fallback: 若来自 LLMClient 的标准化文本
    if (/^HTTP\s+\d+:/i.test(message)) {
      const m = message.match(/^HTTP\s+(\d+):\s*(.*)$/i);
      const status = m ? Number(m[1]) : undefined;
      const reason = m ? m[2] : message;
      if (status === 429) return this._normalize('rate_limit', { message: reason, status });
      if (status >= 500) return this._normalize('server_error', { message: reason, status });
      if (status >= 400) return this._normalize('client_error', { message: reason, status });
    }

    return this._normalize('unknown_error', { message, code });
  }

  _reason(err) {
    try {
      const r = err.response && err.response.data;
      if (!r) return err.message || '';
      if (typeof r === 'string') return r;
      if (r.error && r.error.message) return r.error.message;
      if (r.message) return r.message;
      return JSON.stringify(r);
    } catch (_) {
      return err.message || '';
    }
  }

  _normalize(type, src) {
    const t = this.knownTypes.includes(type) ? type : 'unknown_error';
    if (!src) return { type: t, message: '' };
    if (typeof src === 'string') return { type: t, message: src };
    const msg = src.message || String(src);
    const out = { type: t, message: msg };
    if (src.status) out.status = src.status;
    if (src.code) out.code = src.code;
    return out;
  }
}

/**
 * 错误归档落盘工具：在 runOutputDir/error/ 下按类型分目录
 */
class ErrorReporter {
  /**
   * @param {string} runOutputDir
   * @param {Object} [options]
   * @param {boolean} [options.copyInput=true] 是否复制原始输入文件
   */
  constructor(runOutputDir, options = {}) {
    this.runOutputDir = runOutputDir;
    this.errorRoot = path.join(runOutputDir, 'error');
    this.copyInput = options.copyInput !== false;
    this.records = [];
  }

  /**
   * 记录一个失败文件，并在磁盘建立目录和记录
   * @param {Object} rec
   * @param {string} rec.filename 相对路径（用于恢复原位置）
   * @param {string} rec.inputPath 绝对路径（错误复制来源）
   * @param {string} rec.stage 处理阶段
   * @param {string} rec.type 错误类型
   * @param {string} rec.message 错误消息
   * @param {number} [rec.status]
   * @param {string} [rec.code]
   * @param {string} [rec.mode]
   * @param {string} [rec.provider]
   * @param {string} [rec.model]
   * @param {number} [rec.attemptsUsed]
   */
  addRecord(rec) {
    const safeType = rec.type || 'unknown_error';
    const dir = path.join(this.errorRoot, safeType, path.dirname(rec.filename));
    this._ensureDir(dir);
    const inputBase = path.basename(rec.filename);
    const destPath = path.join(dir, inputBase);

    // 复制原始输入文件（可选）
    if (this.copyInput && rec.inputPath && fs.existsSync(rec.inputPath)) {
      try {
        fs.copyFileSync(rec.inputPath, destPath);
      } catch (e) {
        // 若复制失败，仍继续写 error.json
      }
    }

    // 写单文件 error.json（与原文件同名同目录）
    try {
      const errorJsonPath = path.join(dir, 'error.json');
      const single = Object.assign({}, rec, {
        timestamp: new Date().toISOString(),
        errorType: rec.type,
      });
      // 多文件共享一个目录的 error.json：采用追加数组模式
      let list = [];
      if (fs.existsSync(errorJsonPath)) {
        try {
          const old = JSON.parse(fs.readFileSync(errorJsonPath, 'utf8'));
          if (Array.isArray(old)) list = old;
        } catch {}
      }
      list.push(single);
      fs.writeFileSync(errorJsonPath, JSON.stringify(list, null, 2), 'utf8');
    } catch {}

    this.records.push(rec);
  }

  /**
   * 写入全量清单 error_manifest.json
   */
  finalize() {
    try {
      this._ensureDir(this.errorRoot);
      const manifest = {
        generatedAt: new Date().toISOString(),
        total: this.records.length,
        byType: this._groupByType(this.records),
        items: this.records,
      };
      fs.writeFileSync(path.join(this.errorRoot, 'error_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      return manifest;
    } catch (e) {
      return null;
    }
  }

  _groupByType(records) {
    const map = {};
    for (const r of records) {
      const t = r.type || 'unknown_error';
      map[t] = (map[t] || 0) + 1;
    }
    return map;
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  ErrorClassifier,
  ErrorReporter,
};


