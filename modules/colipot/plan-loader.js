const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * PlanLoader: 扫描并加载 config/ColipotConfig/*.yaml 方案文件
 */
class PlanLoader {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(process.cwd(), 'config', 'ColipotConfig');
  }

  /**
   * 扫描目录，返回可读取的方案文件绝对路径列表
   */
  listPlanFiles() {
    try {
      if (!fs.existsSync(this.rootDir)) return [];
      const items = fs.readdirSync(this.rootDir);
      return items
        .filter((f) => /\.ya?ml$/i.test(f))
        .map((f) => path.join(this.rootDir, f));
    } catch (_) {
      return [];
    }
  }

  /**
   * 加载单个方案文件（容错：空文件、语法错误返回 null）
   */
  loadPlanFile(filePath) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      if (!text || !text.trim()) return null;
      const obj = yaml.load(text);
      if (!obj || typeof obj !== 'object') return null;
      // 附加文件元信息
      obj.__file = filePath;
      obj.__nameFromFile = path.basename(filePath, path.extname(filePath));
      return obj;
    } catch (_) {
      return null;
    }
  }

  /**
   * 扫描并加载全部方案对象
   */
  loadAllPlans() {
    const files = this.listPlanFiles();
    const plans = [];
    for (const fp of files) {
      const p = this.loadPlanFile(fp);
      if (p) plans.push(p);
    }
    return plans;
  }
}

module.exports = PlanLoader;


