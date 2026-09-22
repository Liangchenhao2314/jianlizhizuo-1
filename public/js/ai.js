/* ============================================================
 * ai.js —— AI 智能优化：豆包/DeepSeek/千问/OpenAI 兼容接入
 *   1) 岗位定向优化（贴 JD → AI 给出差异化修订，逐条应用）
 *   2) ATS 关键词匹配分析
 *   3) 选中内容润色
 *   4) 智能对话（可附带简历上下文）
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;

  const PROVIDERS = {
    doubao: { label: '豆包（火山方舟）', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-pro-32k-250115', tip: '火山方舟控制台创建推理接入点后，模型填接入点 ID 或模型名；有免费额度' },
    deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat', tip: 'deepseek-chat 性价比极高，新用户常有免费额度' },
    qwen: { label: '千问（通义）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', tip: 'DashScope 兼容模式；qwen-turbo 更便宜，有免费额度' },
    openai: { label: 'OpenAI 兼容', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tip: '任何 OpenAI 兼容接口：自定义 baseUrl + 模型 + Key' },
  };

  /* ---------- 核心调用 ---------- */
  async function callAI(messages, opts) {
    const s = RS.state.settings;
    const preset = PROVIDERS[s.provider] || PROVIDERS.deepseek;
    const model = (s.model && s.model.trim()) || preset.model;
    const body = {
      provider: s.provider,
      model,
      messages,
      jsonMode: !!opts.json,
      maxTokens: opts.maxTokens || 4096,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : (s.temperature || 0.4),
    };
    let resp;
    if (s.useServerProxy) {
      resp = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, body, { apiKey: s.apiKey || undefined })),
      });
    } else {
      if (!s.apiKey) throw new Error('未配置 API Key：请在「设置」填写密钥，或开启服务端代理模式');
      const base = (s.baseUrl && s.baseUrl.trim()) || preset.base;
      const payload = {
        model,
        messages,
        temperature: body.temperature,
        max_tokens: body.maxTokens,
        stream: false,
      };
      if (opts.json) payload.response_format = { type: 'json_object' };
      resp = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
        body: JSON.stringify(payload),
      });
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error || ('HTTP ' + resp.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const content = data.content;
    if (typeof content !== 'string') throw new Error('AI 返回内容异常');
    return content;
  }

  function extractJSON(text) {
    if (!text) throw new Error('AI 没有返回内容');
    try { return JSON.parse(text); } catch (e) {}
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try { return JSON.parse(fence[1].trim()); } catch (e) {}
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e) {}
    }
    throw new Error('AI 返回的不是可解析的 JSON：' + text.slice(0, 200));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 岗位定向优化 ---------- */
  const JD_SYSTEM = `你是一位资深简历优化专家与 ATS（应聘者追踪系统）顾问。你会收到两份材料：
1. 求职者的简历结构（JSON 数组，每个板块含标题与文本块，每个文本块带 id）
2. 目标岗位的 JD 文本

你的任务：针对这份 JD 对简历做精准优化。严格遵守：
- 只输出一个 JSON 对象，禁止输出任何 JSON 之外的文字。
- 诚实原则：绝不编造求职者没有的经历、公司、职位、数字。只能把已有内容改写得"更专业、更有行动力、更量化、更贴合 JD 关键词"，并且合理地建立 JD 要求与简历已有内容的关联。
- 对 JD 明确要求、但简历中确实缺失的能力，写入 suggestions，绝不写进 revisions。
- revisions 控制在 1~20 条，只修改真正高价值的内容（经历、项目、技能、自我评价），个人信息不要无谓修改。
- keywordMatch 中 inResume 表示该关键词在简历中是否有对应表述。

JSON 结构（严格遵守）：
{
  "analysis": "对 JD 的解读与整体匹配判断（200字以内）",
  "score": "0到100的匹配度估计（数字）",
  "keywordMatch": [{"keyword":"JD关键词","inResume":true,"evidence":"简历中的对应表述或缺失说明"}],
  "revisions": [{"id":"元素id","old":"原文本","new":"改写后文本","reason":"改写理由（80字以内）"}],
  "additions": [{"section":"建议插入的板块标题","text":"建议新增的内容","reason":"依据 JD 哪条要求"}],
  "removals": [{"id":"元素id","reason":"删除理由"}],
  "suggestions": ["无法靠改写解决的差距及建议，如：缺少某技能/证书，建议如何补充"]
}`;

  async function runJDOptimize(jdText) {
    if (!jdText || !jdText.trim()) { RS.ui.toast('请先粘贴或上传目标岗位 JD', 'warn'); return; }
    const sections = RS.exporters.buildResumeStructure(7000);
    if (!sections.length) { RS.ui.toast('当前简历为空，请先导入简历', 'warn'); return; }
    const userMsg = '# 简历结构（JSON）\n' + JSON.stringify(sections) + '\n\n# 目标岗位 JD\n' + jdText;
    RS.ui.showLoading('AI 正在分析 JD 并优化简历…（约 20~60 秒）');
    try {
      const content = await callAI([
        { role: 'system', content: JD_SYSTEM },
        { role: 'user', content: userMsg },
      ], { json: true, maxTokens: 6000, temperature: 0.3 });
      const result = extractJSON(content);
      RS.ui.renderJdResult(result, jdText);
      RS.ui.toast('JD 优化分析完成，请逐条审阅并应用', 'ok');
    } catch (e) {
      RS.ui.toast('AI 请求失败：' + e.message, 'err');
      console.error(e);
    } finally {
      RS.ui.hideLoading();
    }
  }

  /* ---------- ATS 分析 ---------- */
  const ATS_SYSTEM = `你是一位 ATS（应聘者追踪系统）匹配分析专家。你会收到简历结构与 JD。
任务：量化分析简历与 JD 的关键词匹配度，只输出一个 JSON 对象：
{
  "overall": 0到100的总分（数字）,
  "summary": "总体判断与最需要改进的 1-2 点（160字以内）",
  "keywordMatch": [{"keyword":"JD关键词","inResume":true,"evidence":"简历中的证据或缺失说明"}],
  "gaps": ["关键差距"],
  "tips": ["可落地的改进建议"]
}`;

  async function runATSAnalysis(jdText) {
    if (!jdText || !jdText.trim()) { RS.ui.toast('请先粘贴或上传目标岗位 JD', 'warn'); return; }
    const sections = RS.exporters.buildResumeStructure(7000);
    if (!sections.length) { RS.ui.toast('当前简历为空，请先导入简历', 'warn'); return; }
    const userMsg = '# 简历结构\n' + JSON.stringify(sections) + '\n\n# 目标岗位 JD\n' + jdText;
    RS.ui.showLoading('AI 正在分析关键词匹配度…');
    try {
      const content = await callAI([
        { role: 'system', content: ATS_SYSTEM },
        { role: 'user', content: userMsg },
      ], { json: true, maxTokens: 3000, temperature: 0.3 });
      const result = extractJSON(content);
      RS.ui.renderAtsResult(result);
      RS.ui.toast('ATS 分析完成', 'ok');
    } catch (e) {
      RS.ui.toast('AI 请求失败：' + e.message, 'err');
    } finally {
      RS.ui.hideLoading();
    }
  }

  /* ---------- 选中内容润色 ---------- */
  const POLISH_TONES = {
    professional: '更专业',
    concise: '更简洁',
    result: '更突出成果与数据',
    action: '更有行动力（多用动词）',
    formal: '更正式',
    bilingual: '中英双语对照',
  };
  const POLISH_SYSTEM = `你是一位资深简历润色专家。下面是一段简历文本，请按用户要求润色。
硬性要求：不得编造任何经历、公司、职位、数据；只能基于原文优化表达；语言精炼、有行动力、成果导向。
只输出一个 JSON 对象：{"revised":"润色后的文本","reason":"改动说明（80字以内）"}`;

  async function runPolish(ids, tone) {
    const els = ids.map(id => RS.getEl(id)).filter(Boolean);
    if (!els.length) { RS.ui.toast('请先在画布上选中要润色的文字', 'warn'); return; }
    const text = els.map(e => e.text || '').join('\n');
    const userMsg = '# 简历文本\n' + text + '\n\n# 润色要求\n' + (POLISH_TONES[tone] || '更专业') + '。';
    RS.ui.showLoading('AI 正在润色…');
    try {
      const content = await callAI([
        { role: 'system', content: POLISH_SYSTEM },
        { role: 'user', content: userMsg },
      ], { json: true, maxTokens: 1500, temperature: 0.4 });
      const result = extractJSON(content);
      RS.ui.showPolishModal(ids, text, result);
    } catch (e) {
      RS.ui.toast('AI 请求失败：' + e.message, 'err');
    } finally {
      RS.ui.hideLoading();
    }
  }

  /* ---------- 智能对话 ---------- */
  const CHAT_SYSTEM = `你是「智简简历」内置的 AI 简历助手，帮助用户优化简历、准备面试、规划求职。
规则：
- 使用简体中文回答，专业、友好、简洁。
- 用户可以要求你：根据 JD 优化简历、润色某段文字、分析匹配度、给出面试建议等。
- 当你确实想建议修改简历的某处内容时，在回复的最末尾附加一个 JSON 代码块（不要放在普通文字中）：
{"apply":[{"id":"元素id","new_text":"修改后的文本"}]}
只有给出明确修改建议时才附加，一次最多 5 条；元素 id 只能来自你已见到的简历结构。
其余情况下请用普通文字回答，不要附加 JSON。`;

  async function chatSend(userText, withContext, history) {
    const messages = [{ role: 'system', content: CHAT_SYSTEM }];
    if (withContext) {
      const sections = RS.exporters.buildResumeStructure(4000);
      messages.push({ role: 'user', content: '（以下是当前简历结构，供你后续优化时引用，无需回复）\n' + JSON.stringify(sections) });
    }
    for (const m of history) messages.push(m);
    messages.push({ role: 'user', content: userText });
    try {
      const content = await callAI(messages, { maxTokens: 2500, temperature: 0.5 });
      return content;
    } catch (e) {
      throw e;
    }
  }

  function parseApply(content) {
    const m = content.match(/```json\s*(\{[\s\S]*?\})\s*```/) || content.match(/\{[\s\S]*"apply"[\s\S]*\}/);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[1] || m[0]);
      return obj && Array.isArray(obj.apply) ? obj.apply : null;
    } catch (e) { return null; }
  }

  function applyChatEdits(edits) {
    let n = 0;
    for (const ed of edits) {
      const el = RS.getEl(ed.id);
      if (!el || typeof ed.new_text !== 'string') continue;
      if (el.type !== 'text') continue;
      el.text = ed.new_text;
      if (!el.original) { el.original = { x: el.x, y: el.y, w: el.w, h: el.h }; }
      el.dirty = true;
      n++;
    }
    if (n) {
      RS.render.renderAll();
      RS.commit();
      RS.ui.toast('已应用 ' + n + ' 条 AI 修改（可 Ctrl+Z 撤销）', 'ok');
    }
  }

  /* ---------- 测试连接 ---------- */
  async function testConnection() {
    RS.ui.showLoading('正在测试 AI 服务连接…');
    try {
      const content = await callAI([
        { role: 'system', content: '只回复两个字：成功' },
        { role: 'user', content: '测试' },
      ], { maxTokens: 16, temperature: 0 });
      RS.ui.toast('连接成功：' + String(content).slice(0, 40), 'ok');
    } catch (e) {
      RS.ui.toast('连接失败：' + e.message, 'err');
    } finally {
      RS.ui.hideLoading();
    }
  }

  /* ---------- 应用修订 / 插入新增 ---------- */
  function applyRevision(rev) {
    const el = RS.getEl(rev.id);
    if (!el) { RS.ui.toast('该元素已不存在（可能已被删除）', 'warn'); return false; }
    el.text = rev.new;
    if (!el.original) { el.original = { x: el.x, y: el.y, w: el.w, h: el.h }; }
    el.dirty = true;
    el.aiModified = true;
    RS.render.renderAll();
    RS.commit();
    return true;
  }

  function applyAddition(add) {
    const page = RS.state.pages[RS.state.pages.length - 1];
    if (!page) return;
    const w = page.w || RS.state.pageW, h = page.h || RS.state.pageH;
    // 找到匹配的板块标题，插入到该板块末尾
    let anchor = null;
    for (const el of page.elements) {
      if (el.type === 'text' && el.text && el.text.trim() === (add.section || '').trim()) {
        anchor = el;
      }
    }
    if (anchor) {
      let bottom = anchor.y + anchor.h;
      for (const el of page.elements) {
        if (el.type === 'text' && el.y >= anchor.y && el.y + el.h > bottom) bottom = el.y + el.h;
      }
      let y = bottom + 3;
      if (y + 6 > h - 16) {
        const np = RS.addPage(w, h);
        y = 16;
        RS.addElement(np.id, { type: 'text', text: add.text, x: anchor.x, y, w: anchor.w, h: 6, fontFamily: anchor.fontFamily, fontSizePt: (anchor.fontSizePt || 10) - 1, color: '#000', align: 'left', lineHeight: 1.4, dirty: true, original: { x: anchor.x, y, w: anchor.w, h: 6 } }, true);
        return true;
      }
      RS.addElement(anchor.page, { type: 'text', text: add.text, x: anchor.x, y, w: anchor.w, h: 6, fontFamily: anchor.fontFamily, fontSizePt: (anchor.fontSizePt || 10) - 1, color: '#000', align: 'left', lineHeight: 1.4, dirty: true }, true);
      RS.commit();
      return true;
    }
    // 兜底：放到当前页底部
    let y = 20;
    for (const el of page.elements) y = Math.max(y, el.y + el.h + 3);
    RS.addElement(page.id, { type: 'text', text: add.text, x: 20, y, w: w - 40, h: 6, fontFamily: 'SimSun', fontSizePt: 10, color: '#000', align: 'left', lineHeight: 1.4, dirty: true }, true);
    RS.commit();
    return true;
  }

  RS.ai = {
    PROVIDERS,
    callAI,
    extractJSON,
    esc,
    runJDOptimize,
    runATSAnalysis,
    runPolish,
    chatSend,
    parseApply,
    applyChatEdits,
    testConnection,
    applyRevision,
    applyAddition,
    POLISH_TONES,
  };
})();
