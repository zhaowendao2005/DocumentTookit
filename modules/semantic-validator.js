const chalk = require('chalk');
const SimilarityCalculator = require('../utils/similarity');
const CsvValidator = require('../utils/csv-validator');

/**
 * 增强语义校验系统 - 多样本语义校验与智能决策
 * 提供位置级内容比较、智能投票算法和详细决策日志
 */
class SemanticValidator {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.similarityCalculator = new SimilarityCalculator();
    this.csvValidator = new CsvValidator({ logger: this.logger });
    
    // 校验配置
    this.config = {
      similarityThreshold: options.similarityThreshold || 0.8,
      votingWeights: {
        format: 0.40,      // 格式正确性权重
        completeness: 0.30, // 内容完整性权重  
        semantic: 0.20,     // 语义相似度权重
        length: 0.10        // 长度合理性权重
      },
      minSamples: options.minSamples || 3,
      maxSamples: options.maxSamples || 10
    };

    this.validationLog = [];
  }

  /**
   * 主要校验入口 - 多样本语义校验
   * @param {string[]} samples - 多个LLM回复样本
   * @param {string} sourceFile - 源文件名
   * @returns {Object} 校验结果和决策日志
   */
  async validateMultipleSamples(samples, sourceFile = 'unknown') {
    const startTime = Date.now();
    this.logger.info(chalk.blue(`🔍 开始多样本语义校验: ${sourceFile} (${samples.length}个样本)`));

    if (samples.length < this.config.minSamples) {
      this.logger.warn(`样本数量不足: ${samples.length} < ${this.config.minSamples}`);
      return this.handleInsufficientSamples(samples, sourceFile);
    }

    const validationResult = {
      sourceFile,
      totalSamples: samples.length,
      validSamples: [],
      invalidSamples: [],
      similarityMatrix: [],
      selectedSample: null,
      confidence: 0,
      decisionLog: [],
      processingTime: 0,
      recommendations: []
    };

    try {
      // 1. 预处理和格式校验
      const preprocessed = await this.preprocessSamples(samples);
      validationResult.validSamples = preprocessed.valid;
      validationResult.invalidSamples = preprocessed.invalid;

      if (preprocessed.valid.length === 0) {
        return this.handleNoValidSamples(validationResult);
      }

      // 2. 计算相似度矩阵
      validationResult.similarityMatrix = await this.calculateSimilarityMatrix(preprocessed.valid);

      // 3. 位置级内容比较
      const positionComparison = await this.performPositionLevelComparison(preprocessed.valid);

      // 4. 智能投票决策
      const votingResult = await this.performIntelligentVoting(
        preprocessed.valid, 
        validationResult.similarityMatrix,
        positionComparison
      );

      validationResult.selectedSample = votingResult.winner;
      validationResult.confidence = votingResult.confidence;
      validationResult.decisionLog = votingResult.decisionLog;

      // 5. 异常检测
      const anomalies = this.detectAnomalies(
        validationResult.similarityMatrix, 
        this.config.similarityThreshold
      );

      // 6. 生成建议
      validationResult.recommendations = this.generateRecommendations(
        validationResult, 
        anomalies
      );

      validationResult.processingTime = Date.now() - startTime;

      this.logger.info(chalk.green(
        `✅ 语义校验完成: ${sourceFile} (${validationResult.processingTime}ms, 置信度: ${(validationResult.confidence * 100).toFixed(1)}%)`
      ));

      return validationResult;

    } catch (error) {
      this.logger.error(`语义校验失败: ${sourceFile} - ${error.message}`);
      validationResult.error = error.message;
      validationResult.processingTime = Date.now() - startTime;
      return validationResult;
    }
  }

  /**
   * 预处理样本 - 格式校验和清理
   * 注意：现在接收的samples应该已经是经过格式修复的内容
   */
  async preprocessSamples(samples) {
    const preprocessed = { valid: [], invalid: [] };

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const sampleInfo = {
        index: i,
        content: sample,
        validationResult: null,
        csvData: null,
        score: 0
      };

      try {
        // 对已修复的样本进行最终校验
        const csvValidation = await this.csvValidator.validateAndFix(sample, `sample_${i}`);
        sampleInfo.validationResult = csvValidation;

        // 放宽有效性判断：如果能解析出数据就算有效
        const canParse = csvValidation.parseResult && csvValidation.parseResult.success;
        const hasContent = csvValidation.parseResult && csvValidation.parseResult.data && 
                          csvValidation.parseResult.data.length > 0;
        
        if (canParse && hasContent) {
          sampleInfo.csvData = csvValidation.parseResult.data;
          sampleInfo.score = Math.max(csvValidation.confidence, 0.5); // 至少给50%置信度
          sampleInfo.content = csvValidation.fixed; // 使用最终修复后的内容
          preprocessed.valid.push(sampleInfo);
          
          this.logger.debug(`样本${i}: 有效 (置信度: ${(sampleInfo.score * 100).toFixed(1)}%, 数据行数: ${csvValidation.parseResult.data.length})`);
        } else {
          preprocessed.invalid.push(sampleInfo);
          this.logger.debug(`样本${i}: 无效 (无法解析为有效CSV数据)`);
        }

      } catch (error) {
        sampleInfo.error = error.message;
        preprocessed.invalid.push(sampleInfo);
        this.logger.debug(`样本${i}: 处理失败 - ${error.message}`);
      }
    }

    this.logger.info(`预处理完成: ${preprocessed.valid.length}有效, ${preprocessed.invalid.length}无效`);
    return preprocessed;
  }

  /**
   * 计算相似度矩阵
   */
  async calculateSimilarityMatrix(validSamples) {
    const matrix = [];
    const contents = validSamples.map(s => s.content);

    // 使用现有的批量相似度计算
    const similarities = await this.similarityCalculator.calculateBatchSimilarity(contents);
    
    // 转换为矩阵格式
    let index = 0;
    for (let i = 0; i < validSamples.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < validSamples.length; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else if (i < j) {
          matrix[i][j] = similarities[index].similarity;
          index++;
        } else {
          matrix[i][j] = matrix[j][i]; // 矩阵对称
        }
      }
    }

    return matrix;
  }

  /**
   * 位置级内容比较 - 比较每个表格单元格
   */
  async performPositionLevelComparison(validSamples) {
    const comparison = {
      rowCount: [],
      cellMatches: {},
      contentConsistency: []
    };

    // 统计每个样本的行数
    validSamples.forEach((sample, idx) => {
      const rowCount = sample.csvData ? sample.csvData.length : 0;
      comparison.rowCount.push({ sampleIndex: idx, rowCount });
    });

    // 逐单元格比较（仅比较有相同行数的样本）
    const maxRows = Math.max(...comparison.rowCount.map(r => r.rowCount));
    
    for (let row = 0; row < maxRows; row++) {
      comparison.cellMatches[row] = {};
      const fields = ['编号', '问题', '答案', '答题人', '专业'];
      
      for (const field of fields) {
        const cellValues = [];
        
        validSamples.forEach((sample, idx) => {
          if (sample.csvData && sample.csvData[row] && sample.csvData[row][field]) {
            cellValues.push({
              sampleIndex: idx,
              value: sample.csvData[row][field].toString().trim()
            });
          }
        });

        if (cellValues.length > 1) {
          // 计算单元格内容一致性
          const uniqueValues = [...new Set(cellValues.map(cv => cv.value))];
          const consistency = 1 - (uniqueValues.length - 1) / cellValues.length;
          
          comparison.cellMatches[row][field] = {
            values: cellValues,
            uniqueCount: uniqueValues.length,
            consistency
          };
        }
      }
    }

    return comparison;
  }

  /**
   * 智能投票算法 - 综合多维度评分
   */
  async performIntelligentVoting(validSamples, similarityMatrix, positionComparison) {
    const decisionLog = [];
    const scores = validSamples.map((sample, idx) => ({
      sampleIndex: idx,
      formatScore: 0,
      completenessScore: 0,
      semanticScore: 0,
      lengthScore: 0,
      totalScore: 0,
      details: {}
    }));

    // 1. 格式正确性评分 (40%)
    decisionLog.push("=== 格式正确性评分 ===");
    validSamples.forEach((sample, idx) => {
      const formatScore = sample.validationResult.confidence;
      scores[idx].formatScore = formatScore;
      scores[idx].details.format = {
        confidence: formatScore,
        issues: sample.validationResult.issues.length,
        autoFixed: sample.validationResult.autoFixed.length
      };
      decisionLog.push(`样本${idx}: 格式分=${(formatScore * 100).toFixed(1)}% (${sample.validationResult.issues.length}个问题)`);
    });

    // 2. 内容完整性评分 (30%) 
    decisionLog.push("\n=== 内容完整性评分 ===");
    const maxRowCount = Math.max(...validSamples.map(s => s.csvData ? s.csvData.length : 0));
    validSamples.forEach((sample, idx) => {
      const rowCount = sample.csvData ? sample.csvData.length : 0;
      const avgAnswerLength = sample.csvData ? 
        sample.csvData.reduce((sum, row) => sum + (row['答案'] || '').length, 0) / Math.max(rowCount, 1) : 0;
      
      const completenessScore = (rowCount / maxRowCount) * 0.7 + 
                               Math.min(avgAnswerLength / 100, 1) * 0.3;
      
      scores[idx].completenessScore = completenessScore;
      scores[idx].details.completeness = {
        rowCount,
        avgAnswerLength: Math.round(avgAnswerLength),
        score: completenessScore
      };
      decisionLog.push(`样本${idx}: 完整性分=${(completenessScore * 100).toFixed(1)}% (${rowCount}行, 平均答案长度${Math.round(avgAnswerLength)})`);
    });

    // 3. 语义相似度评分 (20%)
    decisionLog.push("\n=== 语义相似度评分 ===");
    validSamples.forEach((sample, idx) => {
      const similarities = similarityMatrix[idx];
      const avgSimilarity = similarities.reduce((sum, sim, i) => 
        i !== idx ? sum + sim : sum, 0) / Math.max(similarities.length - 1, 1);
      
      scores[idx].semanticScore = avgSimilarity;
      scores[idx].details.semantic = {
        avgSimilarity,
        maxSimilarity: Math.max(...similarities.filter((_, i) => i !== idx)),
        minSimilarity: Math.min(...similarities.filter((_, i) => i !== idx))
      };
      decisionLog.push(`样本${idx}: 语义分=${(avgSimilarity * 100).toFixed(1)}% (平均相似度)`);
    });

    // 4. 长度合理性评分 (10%)
    decisionLog.push("\n=== 长度合理性评分 ===");
    const lengths = validSamples.map(s => s.content.length);
    const avgLength = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    validSamples.forEach((sample, idx) => {
      const lengthDiff = Math.abs(sample.content.length - avgLength) / avgLength;
      const lengthScore = Math.max(0, 1 - lengthDiff);
      
      scores[idx].lengthScore = lengthScore;
      scores[idx].details.length = {
        actualLength: sample.content.length,
        avgLength: Math.round(avgLength),
        deviation: lengthDiff,
        score: lengthScore
      };
      decisionLog.push(`样本${idx}: 长度分=${(lengthScore * 100).toFixed(1)}% (长度${sample.content.length}, 偏差${(lengthDiff * 100).toFixed(1)}%)`);
    });

    // 5. 计算加权总分
    decisionLog.push("\n=== 综合评分与决策 ===");
    const weights = this.config.votingWeights;
    scores.forEach((score, idx) => {
      score.totalScore = 
        score.formatScore * weights.format +
        score.completenessScore * weights.completeness +
        score.semanticScore * weights.semantic +
        score.lengthScore * weights.length;
      
      decisionLog.push(
        `样本${idx}: 总分=${(score.totalScore * 100).toFixed(1)}% ` +
        `[格式${(score.formatScore * 100).toFixed(1)}% × ${weights.format}, ` +
        `完整${(score.completenessScore * 100).toFixed(1)}% × ${weights.completeness}, ` +
        `语义${(score.semanticScore * 100).toFixed(1)}% × ${weights.semantic}, ` +
        `长度${(score.lengthScore * 100).toFixed(1)}% × ${weights.length}]`
      );
    });

    // 6. 选择获胜者
    const winner = scores.reduce((best, current) => 
      current.totalScore > best.totalScore ? current : best
    );

    decisionLog.push(`\n🏆 获胜者: 样本${winner.sampleIndex} (总分: ${(winner.totalScore * 100).toFixed(1)}%)`);

    return {
      winner: validSamples[winner.sampleIndex],
      confidence: winner.totalScore,
      scores,
      decisionLog
    };
  }

  /**
   * 异常检测
   */
  detectAnomalies(similarityMatrix, threshold) {
    const anomalies = [];
    
    for (let i = 0; i < similarityMatrix.length; i++) {
      const similarities = similarityMatrix[i];
      const avgSimilarity = similarities.reduce((sum, sim, j) => 
        i !== j ? sum + sim : sum, 0) / Math.max(similarities.length - 1, 1);
      
      if (avgSimilarity < threshold) {
        anomalies.push({
          sampleIndex: i,
          avgSimilarity,
          type: 'low_similarity',
          severity: avgSimilarity < threshold * 0.7 ? 'high' : 'medium'
        });
      }
    }

    return anomalies;
  }

  /**
   * 生成建议
   */
  generateRecommendations(validationResult, anomalies) {
    const recommendations = [];

    // 基于置信度的建议
    if (validationResult.confidence < 0.7) {
      recommendations.push({
        type: 'low_confidence',
        message: `整体置信度较低 (${(validationResult.confidence * 100).toFixed(1)}%)，建议人工审核`,
        priority: 'high'
      });
    }

    // 基于异常的建议
    if (anomalies.length > 0) {
      recommendations.push({
        type: 'anomaly_detected',
        message: `检测到${anomalies.length}个异常样本，可能存在格式或内容问题`,
        priority: 'medium',
        details: anomalies
      });
    }

    // 基于样本数量的建议
    if (validationResult.validSamples.length < this.config.minSamples) {
      recommendations.push({
        type: 'insufficient_samples',
        message: `有效样本数量不足 (${validationResult.validSamples.length} < ${this.config.minSamples})，建议增加请求次数`,
        priority: 'medium'
      });
    }

    return recommendations;
  }

  /**
   * 处理样本不足的情况
   */
  handleInsufficientSamples(samples, sourceFile) {
    this.logger.warn(`样本数量不足，使用单样本模式: ${sourceFile}`);
    
    return {
      sourceFile,
      totalSamples: samples.length,
      selectedSample: { content: samples[0] || '', index: 0 },
      confidence: 0.5, // 默认中等置信度
      decisionLog: ['样本数量不足，跳过多样本校验'],
      recommendations: [{
        type: 'insufficient_samples',
        message: '建议增加请求次数以启用多样本校验',
        priority: 'high'
      }],
      fallbackMode: true
    };
  }

  /**
   * 处理无有效样本的情况
   */
  handleNoValidSamples(validationResult) {
    this.logger.error(`无有效样本: ${validationResult.sourceFile}`);
    
    validationResult.selectedSample = null;
    validationResult.confidence = 0;
    validationResult.decisionLog = ['所有样本都无效，无法进行校验'];
    validationResult.recommendations = [{
      type: 'no_valid_samples',
      message: '所有样本都存在格式问题，建议检查系统提示词',
      priority: 'critical'
    }];

    return validationResult;
  }

  /**
   * 获取详细的决策日志（格式化）
   */
  getFormattedDecisionLog(validationResult) {
    if (!validationResult.decisionLog || validationResult.decisionLog.length === 0) {
      return '无决策日志';
    }

    return validationResult.decisionLog.join('\n');
  }

  /**
   * 导出校验报告为JSON
   */
  exportValidationReport(validationResult, outputPath) {
    const report = {
      timestamp: new Date().toISOString(),
      sourceFile: validationResult.sourceFile,
      summary: {
        totalSamples: validationResult.totalSamples,
        validSamples: validationResult.validSamples.length,
        invalidSamples: validationResult.invalidSamples.length,
        confidence: validationResult.confidence,
        processingTime: validationResult.processingTime
      },
      selectedSample: validationResult.selectedSample ? {
        index: validationResult.selectedSample.index,
        score: validationResult.selectedSample.score
      } : null,
      decisionLog: validationResult.decisionLog,
      recommendations: validationResult.recommendations,
      similarityMatrix: validationResult.similarityMatrix
    };

    require('fs').writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    this.logger.info(`校验报告已导出: ${outputPath}`);
  }
}

module.exports = SemanticValidator;
