/**
 * JSON 安全解析与容错工具
 */
class JsonUtils {
  /**
   * 预处理文本：去除代码围栏、移除BOM、修剪首尾空白
   */
  static preprocessText(raw) {
    if (typeof raw !== 'string') return raw;
    let text = raw;
    // 去BOM
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    // 去围栏 ```json ... ``` 或 ``` ... ```
    const fenceJson = /```\s*json\s*\n([\s\S]*?)```/i;
    const fenceAny = /```\s*\n([\s\S]*?)```/i;
    const m1 = text.match(fenceJson);
    if (m1 && m1[1]) text = m1[1];
    else {
      const m2 = text.match(fenceAny);
      if (m2 && m2[1]) text = m2[1];
    }
    return text.trim();
  }

  /**
   * 安全解析 JSON。若失败，尝试轻量容错（不改变语义）：
   * - 将单引号换为双引号（仅在明显是JSON对象时）
   * - 移除尾随逗号
   */
  static safeParseJson(rawText) {
    let text = JsonUtils.preprocessText(rawText);
    try {
      return { ok: true, data: JSON.parse(text), raw: text, repaired: false };
    } catch (_) {}

    // 简易容错：单引号→双引号（仅外层看起来像JSON时）
    if (/^[\s\S]*\{[\s\S]*\}[\s\S]*$/.test(text) || /^[\s\S]*\[[\s\S]*\][\s\S]*$/.test(text)) {
      const replacedQuotes = text
        .replace(/\r/g, '')
        .replace(/\n/g, '\n')
        .replace(/'(?=([^\\"]*\\"[^\\"]*\\")*[^\\"]*$)/g, '"');
      try {
        return { ok: true, data: JSON.parse(replacedQuotes), raw: replacedQuotes, repaired: true };
      } catch (_) {}

      // 移除对象/数组中的尾随逗号
      const noTrailingComma = replacedQuotes
        .replace(/,\s*([\}\]])/g, '$1');
      try {
        return { ok: true, data: JSON.parse(noTrailingComma), raw: noTrailingComma, repaired: true };
      } catch (_) {}
    }

    return { ok: false, error: 'JSON解析失败', raw: text };
  }
}

module.exports = JsonUtils;


