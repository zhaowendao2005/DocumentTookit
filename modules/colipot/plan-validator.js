/**
 * PlanValidator: 对从 YAML 读取的方案对象进行静态校验与规范化
 */
class PlanValidator {
  /**
   * 校验方案（只做最小必要校验，不访问外部配置）
   * @param {object} plan
   * @returns {{ok:boolean, errors:string[], normalized?:object}}
   */
  static validate(plan) {
    const errors = [];
    const safe = (v, t) => (typeof v === t ? v : undefined);

    if (!plan || typeof plan !== 'object') {
      return { ok: false, errors: ['方案对象无效'] };
    }

    const name = plan.name || plan.__nameFromFile;
    if (!name || typeof name !== 'string') errors.push('缺少 name');

    const displayName = safe(plan.display_name, 'string') || name;

    const model = plan.model || {};
    if (!model.provider || !model.model) errors.push('缺少 model.provider 或 model.model');

    const paths = plan.paths || {};
    if (!paths.output_dir) errors.push('缺少 paths.output_dir');
    if (!Array.isArray(paths.inputs) || paths.inputs.length === 0) errors.push('缺少 paths.inputs');

    const normalized = {
      name,
      display_name: displayName,
      model: {
        provider: model.provider,
        model: model.model,
      },
      processing: plan.processing || {},
      structured: plan.structured || {},
      validation: plan.validation || {},
      network: plan.network || {},
      concurrency: plan.concurrency || {},
      paths: {
        inputs: Array.isArray(paths.inputs) ? paths.inputs : [],
        output_dir: paths.output_dir,
      },
      postprocess: plan.postprocess || {},
      llm_summary: plan.llm_summary || {},
      __file: plan.__file,
    };

    return { ok: errors.length === 0, errors, normalized };
  }
}

module.exports = PlanValidator;


