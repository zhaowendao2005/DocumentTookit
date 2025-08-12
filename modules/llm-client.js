const axios = require('axios');
let OpenAI = null;
try {
  // 动态加载，未安装时回退axios实现
  OpenAI = require('openai');
} catch (_) {}

/**
 * 通用 LLM 客户端（优先使用 OpenAI SDK，失败回退 axios）
 */
class LLMClient {
  /**
   * @param {Object} options
   * @param {Array} options.providers - 配置中的 providers
   * @param {Object} options.retry - 重试配置 { enable_auto_retry, max_retry_count, retry_delay_ms }
   */
  constructor({ providers, retry }) {
    this.providers = providers || [];
    this.retry = Object.assign(
      { enable_auto_retry: true, max_retry_count: 3, retry_delay_ms: 1000 },
      retry || {}
    );
  }

  /**
   * 发送聊天补全请求
   * @param {Object} params
   * @param {string} params.providerName
   * @param {string} params.model
   * @param {Array} params.messages - [{ role, content }]
   * @param {Object} [params.extra] - 额外可选参数，如 temperature、max_tokens
   * @param {Object} [params.timeouts] - { connectTimeoutMs, responseTimeoutMs }
   * @returns {Promise<{ text: string, raw: Object }>} 
   */
  async chatCompletion({ providerName, model, messages, extra = {}, timeouts = {} }) {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      throw new Error(`未找到提供商: ${providerName}`);
    }

    const baseUrl = (provider.base_url || '').replace(/\/$/, '');
    const apiKey = provider.api_key || '';

    // 发送 OpenAI 兼容聊天接口请求
    const url = `${baseUrl}/v1/chat/completions`;
    const connectTimeoutMs = Math.max(500, Number(timeouts.connectTimeoutMs) || 3000);
    const responseTimeoutMs = Math.max(1000, Number(timeouts.responseTimeoutMs) || 60000);

    const shouldRetry = (error) => {
      if (!this.retry.enable_auto_retry) return false;
      if (error && error.response) {
        const status = error.response.status;
        // 5xx 服务端错误、429 限流
        return status >= 500 || status === 429;
      }
      // 网络/超时 类错误
      return true;
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let lastErr = null;
    for (let attempt = 0; attempt <= (this.retry.max_retry_count || 0); attempt++) {
      try {
        // 快速连通性检查（ping models端点），避免把长响应超时当作网络不通
        await this.pingProvider({ baseUrl, apiKey, timeout: connectTimeoutMs });

        // 优先使用 OpenAI SDK（若可用）
        if (OpenAI) {
          const sdkBase = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
          const client = new OpenAI({
            apiKey: apiKey,
            baseURL: sdkBase,
            timeout: responseTimeoutMs,
            maxRetries: this.retry.enable_auto_retry ? (this.retry.max_retry_count || 0) : 0,
          });

          try {
            const resp = await client.chat.completions.create({
              model,
              messages,
              ...extra,
            });

            const text = this.extractTextFromResponse(resp);
            return { text, raw: resp };
          } catch (sdkErr) {
            lastErr = sdkErr;
            // SDK失败后继续回退到 axios 实现
          }
        }

        // 回退 axios 实现
        const resp = await axios.post(
          url,
          Object.assign({ model, messages, temperature: 0.2 }, extra),
          {
            headers: Object.assign(
              { 'Content-Type': 'application/json' },
              apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
            ),
            timeout: responseTimeoutMs,
          }
        );

        const text = this.extractTextFromResponse(resp.data);
        return { text, raw: resp.data };
      } catch (err) {
        lastErr = err;
        if (attempt >= (this.retry.max_retry_count || 0) || !shouldRetry(err)) {
          break;
        }
        await sleep(this.retry.retry_delay_ms || 1000);
      }
    }

    // 统一错误消息，包含可能的HTTP状态与服务端信息
    if (lastErr && lastErr.response) {
      const status = lastErr.response.status;
      const data = lastErr.response.data;
      const reason = (data && (data.error?.message || data.message)) || lastErr.message;
      throw new Error(`HTTP ${status}: ${reason}`);
    }

    throw new Error(`LLM 请求失败: ${lastErr?.message || '未知错误'}`);
  }

  /**
   * 从不同响应格式中提取文本
   */
  extractTextFromResponse(data) {
    // OpenAI SDK 返回对象
    if (data && data.choices && data.choices[0]) {
      const choice = data.choices[0];
      if (choice.message && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      if (typeof choice.text === 'string') return choice.text;
    }

    // OpenAI Responses API（统一响应）
    if (data && data.output && Array.isArray(data.output)) {
      const textNodes = [];
      for (const item of data.output) {
        if (item && item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' && typeof c.text === 'string') {
              textNodes.push(c.text);
            }
          }
        }
      }
      if (textNodes.length) return textNodes.join('\n');
    }

    // Claude v1/v2 风格
    if (data && data.completion && typeof data.completion === 'string') {
      return data.completion;
    }

    // 兜底
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /**
   * 连通性检查：尝试访问 /v1/models（带短超时）。
   * 如返回任意HTTP响应则视为可达；仅网络/超时错误才算失败。
   */
  async pingProvider({ baseUrl, apiKey, timeout }) {
    const url = `${baseUrl}/v1/models`;
    try {
      await axios.get(url, {
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        ),
        // 较短的连接超时时间
        timeout,
        validateStatus: () => true, // 任何状态码都认为连通
      });
      return true;
    } catch (err) {
      // 仅在典型网络错误或超时时失败
      const code = err.code || '';
      if (code === 'ECONNABORTED' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
        throw new Error(`连接超时或网络不可达（ping失败，超时 ${timeout}ms）`);
      }
      // 其他错误（如401/404）视为可达
      return true;
    }
  }
}

module.exports = LLMClient;


