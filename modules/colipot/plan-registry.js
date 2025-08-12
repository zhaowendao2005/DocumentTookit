const PlanLoader = require('./plan-loader');
const PlanValidator = require('./plan-validator');

/**
 * PlanRegistry: 缓存与查询方案；对外提供列表与查找
 */
class PlanRegistry {
  constructor(options = {}) {
    this.loader = new PlanLoader(options);
    this.plans = [];
  }

  /**
   * 扫描并刷新注册表
   */
  refresh() {
    const loaded = this.loader.loadAllPlans();
    const valid = [];
    for (const p of loaded) {
      const v = PlanValidator.validate(p);
      if (v.ok) valid.push(v.normalized);
    }
    this.plans = valid;
    return this.plans;
  }

  /**
   * 获取全部方案（若未加载则自动刷新）
   */
  getAll() {
    if (!this.plans || this.plans.length === 0) this.refresh();
    return this.plans;
  }

  /**
   * 按 name 查找
   */
  getByName(name) {
    return this.getAll().find((p) => p.name === name) || null;
  }
}

module.exports = PlanRegistry;


