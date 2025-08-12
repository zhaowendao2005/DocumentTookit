const path = require('path');

/**
 * PlanInjector: 将方案字段映射/合并到现有调用参数与配置对象（装饰器风格的集中注入器）
 */
class PlanInjector {
  /**
   * 将方案映射为 classic/structured 两种 runBatch 的入参
   * @param {object} plan - 已校验并规范化的方案
   * @param {object} config - 当前 env 配置对象
   * @returns {{modelSel:object, inputs:string[]|string, outputDir:string, options?:object}}
   */
  static mapToRunBatchArgs(plan, config) {
    const modelSel = {
      provider: plan.model.provider,
      model: plan.model.model,
      validation: undefined,
      timeouts: undefined,
    };

    // timeouts 合并
    const conn = Number(plan.network?.connect_timeout_ms ?? config?.network?.connect_timeout_ms);
    const resp = Number(plan.network?.response_timeout_ms ?? config?.network?.response_timeout_ms);
    modelSel.timeouts = {
      connectTimeoutMs: isFinite(conn) && conn > 0 ? conn : 3000,
      responseTimeoutMs: isFinite(resp) && resp > 0 ? resp : 60000,
    };

    // validation 合并
    if (plan.validation && typeof plan.validation === 'object') {
      modelSel.validation = {
        enableMultiple: !!plan.validation.enable_multiple_requests,
        requestCount: clamp(plan.validation.request_count, 1, 10, config?.validation?.request_count ?? 1),
        similarityThreshold: clampFloat(plan.validation.similarity_threshold, 0, 1, config?.validation?.similarity_threshold ?? 0.8),
      };
    }

    // 输入与输出
    const inputs = Array.isArray(plan.paths?.inputs) ? plan.paths.inputs : [];
    const outputDir = plan.paths?.output_dir || config?.directories?.output_dir || './data/output';

    // options: structured 专用
    const options = {};
    const mode = plan.processing?.mode || config?.processing?.default_mode || 'classic';
    if (mode === 'structured') {
      options.promptVersion = plan.structured?.prompt_version || config?.structured?.default_prompt_version;
      if (plan.structured?.repair_attempts != null) {
        options.repairAttempts = clamp(plan.structured.repair_attempts, 0, 3, config?.structured?.max_repair_attempts ?? 2);
      }
    }

    return { modelSel, inputs, outputDir, mode, options };
  }
}

function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  const x = Math.max(min, Math.min(max, n));
  return Number.isFinite(x) ? x : fallback;
}

module.exports = PlanInjector;


