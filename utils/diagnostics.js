const fs = require('fs');
const path = require('path');

function ensureDirectory(directoryPath) {
  try {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function getLogTargets() {
  const appRoot = process.cwd();
  const primary = path.join(appRoot, 'app', 'data', 'logs');
  const fallback = path.join(require('os').tmpdir(), 'BatchLLM');
  if (ensureDirectory(primary)) return { dir: primary, fallback: false };
  ensureDirectory(fallback);
  return { dir: fallback, fallback: true };
}

function writeLog(filePath, text) {
  try { fs.appendFileSync(filePath, text + (text.endsWith('\n') ? '' : '\n'), 'utf8'); } catch {}
}

function fmt(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

async function pingUrl(url, headers = {}, timeoutMs = 2000) {
  const axios = require('axios');
  try {
    await axios.get(url, { headers, timeout: timeoutMs, validateStatus: () => true });
    return { ok: true };
  } catch (e) {
    const code = e.code || '';
    const msg = e.message || 'unknown';
    return { ok: false, code, message: msg };
  }
}

async function runStartupDiagnostics(options = {}) {
  const { pingProvider = true, logToConsole = true } = options;
  const { dir, fallback } = getLogTargets();
  const logFile = path.join(dir, 'startup_diagnostics.log');

  const log = (m) => {
    const line = `[DIAG ${new Date().toISOString()}] ${m}`;
    if (logToConsole) console.log(line);
    writeLog(logFile, line);
  };

  try {
    log(`log file: ${logFile} (fallback=${fallback})`);
    log(`execPath=${process.execPath}`);
    log(`cwd=${process.cwd()}`);
    log(`platform=${process.platform} arch=${process.arch}`);
    log(`nodeVersion=${process.version}`);

    // 路径与文件存在性检查
    const appDir = path.join(process.cwd(), 'app');
    const checks = [
      path.join(appDir, 'main.js'),
      path.join(appDir, 'config', 'env.yaml'),
      path.join(appDir, 'config', 'env.yaml.example'),
      path.join(appDir, 'prompts'),
      path.join(appDir, 'utils', 'rules'),
      path.join(appDir, 'node_modules'),
    ];
    for (const p of checks) {
      const exists = fs.existsSync(p);
      log(`check exists: ${p} -> ${exists}`);
    }

    // 写权限检查
    const writeTargets = [
      path.join(appDir, 'data', 'logs'),
      path.join(appDir, 'data', 'temp'),
    ];
    for (const d of writeTargets) {
      const ok = ensureDirectory(d);
      log(`ensure dir: ${d} -> ${ok}`);
      try {
        const fp = path.join(d, `__write_test_${Date.now()}.tmp`);
        fs.writeFileSync(fp, 'ok', 'utf8');
        fs.unlinkSync(fp);
        log(`write test OK: ${d}`);
      } catch (e) {
        log(`write test FAIL: ${d} -> ${e.message}`);
      }
    }

    // 配置加载可达性（不解析，仅读取）
    try {
      const envPath = path.join(appDir, 'config', 'env.yaml');
      if (fs.existsSync(envPath)) {
        const size = fs.statSync(envPath).size;
        log(`env.yaml exists, size=${size}`);
      } else {
        log(`env.yaml MISSING. 请复制 app\\config\\env.yaml.example 为 app\\config\\env.yaml`);
      }
    } catch (e) {
      log(`env.yaml check error: ${e.message}`);
    }

    // Provider 可达性（短超时）
    if (pingProvider) {
      try {
        const yaml = require('js-yaml');
        const envPath = path.join(appDir, 'config', 'env.yaml');
        if (fs.existsSync(envPath)) {
          const cfg = yaml.load(fs.readFileSync(envPath, 'utf8')) || {};
          const p = Array.isArray(cfg.providers) ? cfg.providers[0] : null;
          if (p && p.base_url) {
            const base = String(p.base_url).replace(/\/$/, '');
            const url = `${base}/v1/models`;
            const headers = p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {};
            const res = await pingUrl(url, headers, 2000);
            log(`ping ${url} -> ${fmt(res)}`);
          } else {
            log(`providers[0] 缺失或无 base_url，跳过 ping`);
          }
        }
      } catch (e) {
        log(`ping provider error: ${e.message}`);
      }
    }
  } catch (e) {
    writeLog(logFile, `[DIAG FATAL] ${e.message}`);
  }

  return { logFile };
}

module.exports = { runStartupDiagnostics };


