const fs = require('fs');
const path = require('path');

/**
 * 轻量 JSON Schema 校验器（专注 rows schema）
 * - 仅支持部分关键校验：type、required、properties、minItems、maxItems、minLength、maxLength、pattern、enum
 * - 以字段级错误形式返回，便于提示 LLM 进行 JSON 修复
 */
class JsonSchemaValidator {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.schema = null;
  }

  loadSchema(schemaPath) {
    const abs = path.isAbsolute(schemaPath) ? schemaPath : path.join(process.cwd(), schemaPath);
    const content = fs.readFileSync(abs, 'utf8');
    this.schema = JSON.parse(content);
    return this.schema;
  }

  /**
   * 校验对象并返回错误数组
   * @param {any} data
   * @param {object} schema - 若未提供则使用已加载的 schema
   * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
   */
  validate(data, schema = null) {
    const useSchema = schema || this.schema;
    if (!useSchema) {
      throw new Error('Schema 未加载');
    }
    const errors = [];

    const walk = (value, nodeSchema, currentPath) => {
      if (!nodeSchema) return;

      // type 校验
      if (nodeSchema.type) {
        if (!this.checkType(value, nodeSchema.type)) {
          errors.push({ path: currentPath, message: `类型应为 ${nodeSchema.type}` });
          return; // 类型错误时无需继续深入
        }
      }

      // enum
      if (nodeSchema.enum && !nodeSchema.enum.includes(value)) {
        errors.push({ path: currentPath, message: `取值必须在枚举 ${JSON.stringify(nodeSchema.enum)} 之中` });
      }

      // 字符串约束
      if (typeof value === 'string') {
        if (typeof nodeSchema.minLength === 'number' && value.length < nodeSchema.minLength) {
          errors.push({ path: currentPath, message: `长度至少为 ${nodeSchema.minLength}` });
        }
        if (typeof nodeSchema.maxLength === 'number' && value.length > nodeSchema.maxLength) {
          errors.push({ path: currentPath, message: `长度不能超过 ${nodeSchema.maxLength}` });
        }
        if (nodeSchema.pattern) {
          try {
            const reg = new RegExp(nodeSchema.pattern);
            if (!reg.test(value)) {
              errors.push({ path: currentPath, message: `不匹配模式 ${nodeSchema.pattern}` });
            }
          } catch (_e) {}
        }
      }

      // 数组约束
      if (Array.isArray(value)) {
        if (typeof nodeSchema.minItems === 'number' && value.length < nodeSchema.minItems) {
          errors.push({ path: currentPath, message: `数组元素至少 ${nodeSchema.minItems} 个` });
        }
        if (typeof nodeSchema.maxItems === 'number' && value.length > nodeSchema.maxItems) {
          errors.push({ path: currentPath, message: `数组元素不能超过 ${nodeSchema.maxItems} 个` });
        }
        if (nodeSchema.items) {
          value.forEach((child, idx) => walk(child, nodeSchema.items, `${currentPath}[${idx}]`));
        }
      }

      // 对象约束
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const props = nodeSchema.properties || {};
        const required = nodeSchema.required || [];
        required.forEach((key) => {
          if (!(key in value)) {
            errors.push({ path: currentPath ? `${currentPath}.${key}` : key, message: '缺少必填字段' });
          }
        });
        Object.keys(props).forEach((key) => {
          if (key in value) {
            walk(value[key], props[key], currentPath ? `${currentPath}.${key}` : key);
          }
        });
      }
    };

    walk(data, useSchema, '');
    return { valid: errors.length === 0, errors };
  }

  checkType(value, type) {
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value);
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && !Number.isNaN(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'null') return value === null;
    return true; // 未声明类型时放过
  }
}

module.exports = JsonSchemaValidator;


