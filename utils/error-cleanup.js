const fs = require('fs');
const path = require('path');

/**
 * 重处理清理工具：
 * - 删除已修复文件在 error 目录中的原始拷贝
 * - 更新 error.json 与 error_manifest.json
 */
async function applyCleanup({ runOutputDir, errorDir, result, logger = console, options = {} }) {
  try {
    const removeEmptyErrorDir = options.remove_empty_error_dir !== false;
    const pruneFixedEntries = options.prune_fixed_entries === true; // 默认仅标记，不移除

    const supportedExts = new Set(['.md', '.txt', '.docx']);
    const successSet = new Set();
    for (const f of (result.files || [])) {
      if (f && f.succeeded && f.filename) successSet.add(f.filename);
    }
    if (successSet.size === 0) return;

    // 遍历 errorDir 下的类型子目录
    const typeDirs = fs.existsSync(errorDir) ? fs.readdirSync(errorDir, { withFileTypes: true }).filter(d => d.isDirectory()) : [];
    for (const td of typeDirs) {
      const tdir = path.join(errorDir, td.name);
      const entries = fs.readdirSync(tdir, { withFileTypes: true });
      // 更新 error.json（列表型）
      const errJsonPath = path.join(tdir, 'error.json');
      let arr = [];
      if (fs.existsSync(errJsonPath)) {
        try { const old = JSON.parse(fs.readFileSync(errJsonPath, 'utf8')); if (Array.isArray(old)) arr = old; } catch {}
      }

      // 删除成功文件
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const p = path.join(tdir, ent.name);
        const rel = ent.name; // 我们当初拷贝时保持了原文件名
        const ext = path.extname(p).toLowerCase();
        if (!supportedExts.has(ext)) continue;
        if (successSet.has(rel)) {
          try { fs.unlinkSync(p); } catch {}
          // 在数组中打标记或移除
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            if (item && item.filename === rel) {
              if (pruneFixedEntries) {
                arr.splice(i, 1); i--;
              } else {
                item.fixed = true;
                item.fixedAt = new Date().toISOString();
              }
            }
          }
        }
      }
      try { fs.writeFileSync(errJsonPath, JSON.stringify(arr, null, 2), 'utf8'); } catch {}
    }

    // 更新 error_manifest.json
    const manifestPath = path.join(errorDir, 'error_manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const items = Array.isArray(m.items) ? m.items : [];
        const remaining = [];
        const fixedItems = Array.isArray(m.fixedItems) ? m.fixedItems : [];
        for (const it of items) {
          if (it && successSet.has(it.filename)) {
            if (pruneFixedEntries) {
              // 移动到 fixedItems 供历史保留
              fixedItems.push({ ...it, fixed: true, fixedAt: new Date().toISOString() });
            } else {
              // 保留在 items 里但标记 fixed
              it.fixed = true; it.fixedAt = new Date().toISOString();
              remaining.push(it);
            }
          } else {
            remaining.push(it);
          }
        }
        const byType = {};
        for (const it of remaining) {
          const t = it.type || 'unknown_error';
          byType[t] = (byType[t] || 0) + 1;
        }
        const updated = {
          ...m,
          items: pruneFixedEntries ? remaining : remaining,
          fixedItems,
          byType,
          total: remaining.length,
          lastReprocessAt: new Date().toISOString(),
        };
        fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2), 'utf8');
      } catch {}
    }

    // 若 error 目录已空，则可删除
    if (removeEmptyErrorDir) {
      try {
        const hasResidual = _hasAnyFiles(errorDir);
        if (!hasResidual) {
          fs.rmSync(errorDir, { recursive: true, force: true });
          logger.showInfo ? logger.showInfo('错误目录已清空并删除') : null;
        }
      } catch {}
    }
  } catch (e) {
    throw e;
  }
}

function _hasAnyFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) { if (_hasAnyFiles(p)) return true; }
    else return true;
  }
  return false;
}

module.exports = { applyCleanup };


