const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const chalk = require('chalk');

/**
 * CSV格式校验器 - 专业CSV解析和修复
 * 解决LLM输出包含表头信息、格式错误等问题
 */
class CsvValidator {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.rulesDir = options.rulesDir || path.join(__dirname, 'rules');
    this.autoFix = options.autoFix !== false;
    this.backupOriginal = options.backupOriginal !== false;
    
    // 加载规则配置
    this.formatRules = this.loadRules('format-rules.json');
    this.validationRules = this.loadRules('validation-rules.json');
    this.patternRules = this.loadRules('pattern-rules.json');
    
    this.stats = {
      totalChecked: 0,
      issuesFound: 0,
      autoFixed: 0,
      manualFixRequired: 0
    };
  }

  /**
   * 加载规则文件
   */
  loadRules(filename) {
    try {
      const rulePath = path.join(this.rulesDir, filename);
      const content = fs.readFileSync(rulePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.warn(`加载规则文件失败: ${filename} - ${error.message}`);
      return {};
    }
  }

  /**
   * 主要校验入口 - 校验并修复CSV文件
   * @param {string} csvContent - CSV内容
   * @param {string} filename - 文件名（用于日志）
   * @returns {Object} 校验和修复结果
   */
  async validateAndFix(csvContent, filename = 'unknown') {
    this.stats.totalChecked++;
    const result = {
      filename,
      original: csvContent,
      fixed: csvContent,
      issues: [],
      autoFixed: [],
      requiresManualFix: [],
      isValid: false,
      confidence: 0
    };

    try {
      // 1. 快速预检 - 识别明显问题
      const preCheckIssues = this.preCheck(csvContent);
      result.issues.push(...preCheckIssues);

      // 2. 自动修复（如果启用）
      if (this.autoFix && preCheckIssues.length > 0) {
        result.fixed = await this.applyAutoFixes(csvContent, preCheckIssues);
        result.autoFixed = preCheckIssues.filter(issue => issue.canAutoFix);
        result.requiresManualFix = preCheckIssues.filter(issue => !issue.canAutoFix);
      }

      // 3. 使用Papa Parse进行专业解析校验
      const parseResult = this.parseWithValidation(result.fixed);
      result.parseResult = parseResult;
      
      // 4. 内容质量校验
      if (parseResult.success) {
        const qualityIssues = this.validateContent(parseResult.data);
        result.issues.push(...qualityIssues);
      }

      // 5. 计算整体置信度
      result.confidence = this.calculateConfidence(result);
      // 调整有效性判断：能修复的问题也算基本有效
      result.isValid = (result.confidence > 0.6) || 
                      (result.autoFixed.length > 0 && result.confidence > 0.4) ||
                      (parseResult.success && result.confidence > 0.3);

      // 6. 更新统计
      if (result.issues.length > 0) this.stats.issuesFound++;
      if (result.autoFixed.length > 0) this.stats.autoFixed++;
      if (result.requiresManualFix.length > 0) this.stats.manualFixRequired++;

      return result;

    } catch (error) {
      this.logger.error(`CSV校验失败: ${filename} - ${error.message}`);
      result.issues.push({
        type: 'fatal_error',
        severity: 'critical',
        message: `校验过程发生致命错误: ${error.message}`,
        canAutoFix: false
      });
      return result;
    }
  }

  /**
   * 快速预检 - 识别常见格式问题
   */
  preCheck(csvContent) {
    const issues = [];
    const patterns = this.patternRules.common_issues?.patterns || [];

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern.pattern, 'g');
        const matches = csvContent.match(regex);
        
        if (matches && matches.length > 0) {
          issues.push({
            type: pattern.id,
            name: pattern.name,
            severity: pattern.severity,
            message: pattern.description,
            matches: matches.length,
            canAutoFix: pattern.fix_strategy !== 'manual_only',
            fixStrategy: pattern.fix_strategy,
            pattern: pattern.pattern
          });
        }
      } catch (regexError) {
        this.logger.warn(`正则表达式错误: ${pattern.id} - ${regexError.message}`);
      }
    }

    return issues;
  }

  /**
   * 应用自动修复
   */
  async applyAutoFixes(csvContent, issues) {
    let fixed = csvContent;
    const formatRules = this.formatRules.csv_format_rules?.rules || [];
    
    // 按优先级排序规则
    const sortedRules = formatRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    for (const rule of sortedRules) {
      try {
        // 检查是否有对应的问题需要修复
        const relatedIssue = issues.find(issue => 
          issue.type === rule.id || issue.fixStrategy === rule.id
        );
        
        if (!relatedIssue) continue;

        const oldFixed = fixed;
        
        if (rule.pattern && rule.replacement !== undefined) {
          // 基于正则表达式的修复
          const regex = new RegExp(rule.pattern, rule.flags || 'g');
          fixed = fixed.replace(regex, rule.replacement);
        } else if (rule.check === 'field_count_validation') {
          // 字段数量校验和修复
          fixed = this.fixFieldCount(fixed, rule.expected_fields);
        }

        if (fixed !== oldFixed) {
          this.logger.info(`已应用修复规则: ${rule.name}`);
        }

      } catch (error) {
        this.logger.warn(`修复规则应用失败: ${rule.id} - ${error.message}`);
      }
    }

    return fixed;
  }

  /**
   * 修复字段数量问题
   */
  fixFieldCount(csvContent, expectedFields = 5) {
    const lines = csvContent.split('\n').filter(line => line.trim());
    const fixedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 使用Papa Parse来正确解析这一行
      const parseResult = Papa.parse(line, { 
        header: false,
        skipEmptyLines: false,
        transform: (value) => value || ''
      });

      if (parseResult.data && parseResult.data[0]) {
        const fields = parseResult.data[0];
        
        if (fields.length < expectedFields) {
          // 补齐缺失字段
          while (fields.length < expectedFields) {
            fields.push('');
          }
        } else if (fields.length > expectedFields) {
          // 处理字段过多的情况（通常是答案字段包含了额外内容）
          if (fields.length > expectedFields && i > 0) { // 跳过表头行
            // 将多余字段合并到答案字段（索引2）
            const extraContent = fields.slice(expectedFields).join(' ');
            if (extraContent.trim()) {
              fields[2] = (fields[2] || '') + ' ' + extraContent;
            }
            fields.length = expectedFields; // 截断到正确长度
          }
        }

        // 重新组装这一行
        const fixedLine = Papa.unparse([fields], {
          quotes: true,
          quoteChar: '"',
          escapeChar: '"'
        });
        fixedLines.push(fixedLine);
      } else {
        fixedLines.push(line); // 保持原样
      }
    }

    return fixedLines.join('\n');
  }

  /**
   * 使用Papa Parse进行专业解析校验
   */
  parseWithValidation(csvContent) {
    try {
      const parseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        transform: (value, field) => {
          // 清理字段值
          if (typeof value === 'string') {
            return value.trim();
          }
          return value;
        },
        error: (error) => {
          this.logger.warn(`Papa Parse警告: ${error.message}`);
        }
      });

      const result = {
        success: parseResult.errors.length === 0,
        data: parseResult.data,
        errors: parseResult.errors,
        meta: parseResult.meta
      };

      // 额外校验表头
      if (result.success && parseResult.meta.fields) {
        const expectedHeaders = this.formatRules.content_validation?.expected_headers || 
                               ['编号', '问题', '答案', '答题人', '专业'];
        const actualHeaders = parseResult.meta.fields;
        
        const headerMismatch = !this.arraysEqual(expectedHeaders, actualHeaders);
        if (headerMismatch) {
          result.success = false;
          result.errors.push({
            type: 'header_mismatch',
            code: 'HEADER_VALIDATION',
            message: `表头不匹配。期望: [${expectedHeaders.join(', ')}], 实际: [${actualHeaders.join(', ')}]`,
            row: 0
          });
        }
      }

      return result;

    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [{
          type: 'parse_fatal',
          code: 'PARSE_ERROR',
          message: `解析失败: ${error.message}`
        }],
        meta: {}
      };
    }
  }

  /**
   * 内容质量校验
   */
  validateContent(data) {
    const issues = [];
    const validation = this.validationRules.validation_rules?.content_validation || {};
    
    if (!data || !Array.isArray(data)) return issues;

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      
      // 必填字段检查
      const requiredFields = validation.empty_fields?.required_fields || ['编号', '答案'];
      for (const field of requiredFields) {
        if (!row[field] || !row[field].toString().trim()) {
          issues.push({
            type: 'missing_required_field',
            severity: 'high',
            message: `第${rowIndex + 2}行缺少必填字段: ${field}`,
            row: rowIndex + 2,
            field,
            canAutoFix: false
          });
        }
      }

      // 数据类型和格式校验
      const dataTypes = validation.data_types || {};
      for (const [field, rules] of Object.entries(dataTypes)) {
        const value = row[field];
        if (!value && rules.allow_empty) continue;

        // 长度校验
        if (rules.max_length && value && value.length > rules.max_length) {
          issues.push({
            type: 'field_too_long',
            severity: 'medium',
            message: `第${rowIndex + 2}行字段"${field}"超过最大长度${rules.max_length}`,
            row: rowIndex + 2,
            field,
            canAutoFix: false
          });
        }

        // 禁止模式检查
        if (rules.prohibited_patterns && value) {
          for (const pattern of rules.prohibited_patterns) {
            if (value.includes(pattern)) {
              issues.push({
                type: 'prohibited_content',
                severity: 'high',
                message: `第${rowIndex + 2}行字段"${field}"包含禁止内容: ${pattern}`,
                row: rowIndex + 2,
                field,
                canAutoFix: true
              });
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * 计算置信度分数
   */
  calculateConfidence(result) {
    let score = 1.0;
    
    // 解析成功性权重40%
    if (!result.parseResult.success) {
      score -= 0.4;
    }

    // 问题严重程度权重30%
    const severityWeights = { critical: 0.15, high: 0.1, medium: 0.03, low: 0.01 };
    for (const issue of result.issues) {
      score -= severityWeights[issue.severity] || 0.01;
    }

    // 自动修复成功率权重20%
    if (result.issues.length > 0) {
      const autoFixRatio = result.autoFixed.length / result.issues.length;
      score += autoFixRatio * 0.2;
    }

    // 内容完整性权重10%
    if (result.parseResult.data && result.parseResult.data.length > 0) {
      const hasContent = result.parseResult.data.some(row => 
        row['答案'] && row['答案'].toString().trim().length > 10
      );
      if (!hasContent) score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * 生成详细校验报告
   */
  generateReport(results) {
    const report = {
      summary: {
        totalFiles: results.length,
        validFiles: results.filter(r => r.isValid).length,
        issuesFound: results.reduce((sum, r) => sum + r.issues.length, 0),
        autoFixed: results.reduce((sum, r) => sum + r.autoFixed.length, 0),
        avgConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      },
      details: results,
      recommendations: this.generateRecommendations(results)
    };

    return report;
  }

  /**
   * 生成改进建议
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // 分析常见问题模式
    const issueTypes = {};
    results.forEach(result => {
      result.issues.forEach(issue => {
        issueTypes[issue.type] = (issueTypes[issue.type] || 0) + 1;
      });
    });

    // 根据问题频率生成建议
    const sortedIssues = Object.entries(issueTypes).sort((a, b) => b[1] - a[1]);
    
    for (const [issueType, count] of sortedIssues) {
      if (count >= results.length * 0.3) { // 30%以上文件都有此问题
        recommendations.push({
          type: 'high_frequency_issue',
          issue: issueType,
          frequency: count,
          recommendation: this.getRecommendationForIssue(issueType)
        });
      }
    }

    return recommendations;
  }

  /**
   * 获取特定问题的建议
   */
  getRecommendationForIssue(issueType) {
    const suggestions = {
      'header_in_content': '建议优化系统提示词，明确要求LLM只输出CSV数据内容，不包含表头信息',
      'incomplete_code_fence': '建议在提示词中强调输出格式，避免使用代码围栏包裹CSV内容',
      'nested_quotes': '建议在提示词中说明CSV转义规则，字段内的引号需要双重转义',
      'field_overflow': '建议限制答案字段长度，避免内容过长导致格式混乱',
      'missing_required_field': '建议在提示词中强调必填字段的重要性',
      'prohibited_content': '建议在提示词中明确禁止在答案字段中包含格式标记'
    };

    return suggestions[issueType] || '建议检查相关的系统提示词和输出格式要求';
  }

  /**
   * 工具方法 - 数组比较
   */
  arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalChecked: 0,
      issuesFound: 0,
      autoFixed: 0,
      manualFixRequired: 0
    };
  }
}

module.exports = CsvValidator;
