const { pipeline } = require('@xenova/transformers');

class SimilarityCalculator {
    constructor() {
        this.semanticModel = null;
        this.initialized = false;
    }

    /**
     * 初始化语义模型
     */
    async initialize() {
        if (this.initialized) return;
        
        try {
            console.log(' 正在加载语义相似度模型...');
            this.semanticModel = await pipeline(
                'feature-extraction',
                'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
            );
            this.initialized = true;
            console.log('✅ 语义模型加载成功');
        } catch (error) {
            console.error('❌ 语义模型加载失败:', error.message);
            throw error;
        }
    }

    /**
     * 计算语义相似度
     * @param {string} text1 - 文本1
     * @param {string} text2 - 文本2
     * @returns {Promise<number>} 相似度值 (0-1)
     */
    async calculateSemanticSimilarity(text1, text2) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const embedding1 = await this.semanticModel(text1);
            const embedding2 = await this.semanticModel(text2);
            
            return this.cosineSimilarity(embedding1.data, embedding2.data);
        } catch (error) {
            console.error('语义相似度计算失败:', error.message);
            return 0.0;
        }
    }

    /**
     * 计算余弦相似度
     * @param {Array} vec1 - 向量1
     * @param {Array} vec2 - 向量2
     * @returns {number} 余弦相似度
     */
    cosineSimilarity(vec1, vec2) {
        if (vec1.length !== vec2.length) return 0;
        
        const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
        const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
        const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
        
        if (norm1 === 0 || norm2 === 0) return 0;
        return dotProduct / (norm1 * norm2);
    }

    /**
     * 计算编辑距离
     * @param {string} str1 - 字符串1
     * @param {string} str2 - 字符串2
     * @returns {number} 编辑距离
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * 计算基于编辑距离的相似度
     * @param {string} str1 - 字符串1
     * @param {string} str2 - 字符串2
     * @returns {number} 相似度值 (0-1)
     */
    calculateEditSimilarity(str1, str2) {
        const distance = this.levenshteinDistance(str1, str2);
        const maxLength = Math.max(str1.length, str2.length);
        return 1 - (distance / maxLength);
    }

    /**
     * 计算Jaccard相似度
     * @param {string} str1 - 字符串1
     * @param {string} str2 - 字符串2
     * @returns {number} Jaccard相似度
     */
    calculateJaccardSimilarity(str1, str2) {
        const set1 = new Set(str1.split(''));
        const set2 = new Set(str2.split(''));
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return intersection.size / union.size;
    }

    /**
     * 批量计算相似度
     * @param {Array} texts - 文本数组
     * @returns {Promise<Array>} 相似度矩阵
     */
    async calculateBatchSimilarity(texts) {
        const similarities = [];
        
        for (let i = 0; i < texts.length; i++) {
            for (let j = i + 1; j < texts.length; j++) {
                const similarity = await this.calculateSemanticSimilarity(texts[i], texts[j]);
                similarities.push({
                    index1: i,
                    index2: j,
                    text1: texts[i],
                    text2: texts[j],
                    similarity: similarity
                });
            }
        }
        
        return similarities;
    }

    /**
     * 计算平均相似度
     * @param {Array} similarities - 相似度数组
     * @returns {number} 平均相似度
     */
    calculateAverageSimilarity(similarities) {
        if (similarities.length === 0) return 0;
        
        const sum = similarities.reduce((acc, item) => acc + item.similarity, 0);
        return sum / similarities.length;
    }

    /**
     * 检测异常值（相似度明显偏低的配对）
     * @param {Array} similarities - 相似度数组
     * @param {number} threshold - 阈值倍数
     * @returns {Array} 异常值数组
     */
    detectAnomalies(similarities, threshold = 0.6) {
        if (similarities.length === 0) return [];
        
        const avgSimilarity = this.calculateAverageSimilarity(similarities);
        const anomalyThreshold = avgSimilarity * threshold;
        
        return similarities.filter(item => item.similarity < anomalyThreshold);
    }

    /**
     * 获取相似度统计信息
     * @param {Array} similarities - 相似度数组
     * @returns {Object} 统计信息
     */
    getSimilarityStats(similarities) {
        if (similarities.length === 0) {
            return {
                count: 0,
                average: 0,
                min: 0,
                max: 0,
                stdDev: 0
            };
        }
        
        const values = similarities.map(s => s.similarity);
        const average = values.reduce((sum, val) => sum + val, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        
        const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        
        return {
            count: similarities.length,
            average: average,
            min: min,
            max: max,
            stdDev: stdDev
        };
    }
}

module.exports = SimilarityCalculator;
