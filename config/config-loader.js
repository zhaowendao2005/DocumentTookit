const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ConfigLoader {
    /**
     * 加载配置文件
     * @returns {Object} 配置对象
     */
    static async load() {
        try {
            const configPath = path.join(__dirname, 'env.yaml');
            
            if (!fs.existsSync(configPath)) {
                throw new Error(`配置文件不存在: ${configPath}`);
            }
            
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = yaml.load(configContent);
            
            // 验证配置
            this.validate(config);
            
            console.log('✅ 配置文件加载成功');
            return config;
            
        } catch (error) {
            console.error('❌ 配置文件加载失败:', error.message);
            throw error;
        }
    }

    /**
     * 验证配置完整性
     * @param {Object} config - 配置对象
     */
    static validate(config) {
        const required = ['providers', 'directories', 'concurrency', 'validation'];
        
        for (const key of required) {
            if (!config[key]) {
                throw new Error(`缺少必需配置: ${key}`);
            }
        }

        // 验证提供商配置
        if (!Array.isArray(config.providers) || config.providers.length === 0) {
            throw new Error('providers配置必须是非空数组');
        }

        config.providers.forEach((provider, index) => {
            if (!provider.name || !provider.base_url || !Array.isArray(provider.models)) {
                throw new Error(`提供商${index + 1}配置不完整`);
            }
        });

        // 验证目录配置
        const requiredDirs = ['input_dir', 'output_dir', 'temp_dir', 'candidate_tools_dir'];
        requiredDirs.forEach(dirKey => {
            if (!config.directories[dirKey]) {
                throw new Error(`缺少目录配置: ${dirKey}`);
            }
        });

        // 验证并发配置
        if (typeof config.concurrency.max_concurrent_requests !== 'number' || 
            config.concurrency.max_concurrent_requests <= 0) {
            throw new Error('max_concurrent_requests必须是正整数');
        }

        // 验证校验配置
        if (typeof config.validation.enable_multiple_requests !== 'boolean') {
            throw new Error('enable_multiple_requests必须是布尔值');
        }

        if (typeof config.validation.request_count !== 'number' || 
            config.validation.request_count < 1 || 
            config.validation.request_count > 10) {
            throw new Error('request_count必须是1-10之间的整数');
        }

        if (typeof config.validation.similarity_threshold !== 'number' || 
            config.validation.similarity_threshold < 0 || 
            config.validation.similarity_threshold > 1) {
            throw new Error('similarity_threshold必须是0-1之间的数字');
        }

        // 验证系统提示词文件路径
        if (!config.system_prompt_file) {
            throw new Error('缺少system_prompt_file配置');
        }

        console.log('✅ 配置验证通过');
    }

    /**
     * 获取指定提供商的配置
     * @param {string} providerName - 提供商名称
     * @param {Object} config - 配置对象
     * @returns {Object} 提供商配置
     */
    static getProvider(providerName, config) {
        const provider = config.providers.find(p => p.name === providerName);
        if (!provider) {
            throw new Error(`未找到提供商: ${providerName}`);
        }
        return provider;
    }

    /**
     * 获取所有可用的模型列表
     * @param {Object} config - 配置对象
     * @returns {Array} 模型列表
     */
    static getAllModels(config) {
        const models = [];
        config.providers.forEach(provider => {
            provider.models.forEach(model => {
                models.push({
                    provider: provider.name,
                    model: model,
                    displayName: `${provider.name} - ${model}`
                });
            });
        });
        return models;
    }

    /**
     * 检查目录是否存在，不存在则创建
     * @param {Object} config - 配置对象
     */
    static ensureDirectories(config) {
        const dirs = [
            config.directories.input_dir,
            config.directories.output_dir,
            config.directories.temp_dir,
            config.directories.candidate_tools_dir
        ];

        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 创建目录: ${dir}`);
            }
        });
    }
}

module.exports = ConfigLoader;
