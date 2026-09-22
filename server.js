/**
 * 智简简历 · AI Resume Studio —— 服务端
 * 职责：
 *  1. 静态托管前端（public/）
 *  2. POST /api/convert —— Word(.docx/.doc) → PDF 转换（LibreOffice，缺失时返回 501 由前端回退到浏览器端渲染）
 *  3. POST /api/ai —— AI 聊天补全代理（豆包/DeepSeek/千问/OpenAI 兼容），服务端密钥模式下密钥不落地浏览器
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- LibreOffice 探测 ---------------- */
function findSoffice() {
  const candidates = [];
  if (process.env.SOFFICE_PATH) candidates.push(process.env.SOFFICE_PATH);
  const names = ['soffice', 'libreoffice', 'soffice.bin'];
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const common = [
    'C:/Program Files/LibreOffice/program/soffice.exe',
    'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/usr/lib/libreoffice/program/soffice',
  ];
  for (const c of candidates.concat(common)) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  for (const dir of paths) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { if (fs.existsSync(p)) return p; } catch (_) {}
      const pw = path.join(dir, n + '.exe');
      try { if (fs.existsSync(pw)) return pw; } catch (_) {}
    }
  }
  return null;
}
const soffice = findSoffice();

function runSoffice(args) {
  return new Promise((resolve, reject) => {
    execFile(soffice, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).slice(0, 500)));
      else resolve(stdout);
    });
  });
}

/* ---------------- 上传 ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
});

/* ---------------- /api/convert ---------------- */
app.post('/api/convert', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: '未收到文件' });
  const ext = path.extname(file.originalname || file.filename).toLowerCase();
  try {
    if (ext === '.pdf') {
      // PDF 直接透传，前端用 pdf.js 处理
      const data = fs.readFileSync(file.path);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="resume.pdf"`);
      return res.send(data);
    }
    if (['.docx', '.doc', '.odt', '.rtf'].includes(ext)) {
      if (!soffice) {
        return res.status(501).json({ error: '服务器未安装 LibreOffice，无法精确转换，前端将回退到浏览器渲染', fallback: true });
      }
      const outDir = path.join(UPLOAD_DIR, 'lo_' + Date.now());
      fs.mkdirSync(outDir, { recursive: true });
      const profile = path.join(os.tmpdir(), 'lo_profile_' + Date.now());
      try {
        await runSoffice([
          '-env:UserInstallation=file:///' + profile.replace(/\\/g, '/'),
          '--headless',
          '--norestore',
          '--convert-to',
          'pdf:writer_pdf_Export',
          '--outdir',
          outDir,
          file.path,
        ]);
        const pdfName = path.basename(file.filename, ext) + '.pdf';
        const pdfPath = path.join(outDir, pdfName);
        if (!fs.existsSync(pdfPath)) {
          // 部分版本输出名与源文件名一致
          const alt = path.join(outDir, path.basename(file.originalname, ext) + '.pdf');
          const final = fs.existsSync(alt) ? alt : pdfPath;
          if (!fs.existsSync(final)) return res.status(500).json({ error: '转换失败：未生成 PDF' });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="resume.pdf"`);
          return res.send(fs.readFileSync(final));
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="resume.pdf"`);
        return res.send(fs.readFileSync(pdfPath));
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
    return res.status(400).json({ error: '不支持的文件类型：' + ext });
  } catch (e) {
    return res.status(500).json({ error: '转换失败：' + e.message });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

/* ---------------- /api/ai ---------------- */
const PROVIDERS = {
  doubao: { label: '豆包(火山方舟)', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-pro-32k-250115', envKey: 'DOUBAO_API_KEY', envModel: 'DOUBAO_MODEL' },
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY', envModel: 'DEEPSEEK_MODEL' },
  qwen: { label: '千问(通义)', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', envKey: 'QWEN_API_KEY', envModel: 'QWEN_MODEL' },
  openai: { label: 'OpenAI 兼容', base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', envKey: 'OPENAI_API_KEY', envModel: 'OPENAI_MODEL' },
};

app.post('/api/ai', async (req, res) => {
  try {
    const { provider, apiKey, model, messages, jsonMode, maxTokens, temperature } = req.body || {};
    const p = PROVIDERS[provider];
    if (!p) return res.status(400).json({ error: '未知的 AI 服务商：' + provider });
    if (!messages || !Array.isArray(messages) || !messages.length) return res.status(400).json({ error: '缺少 messages' });

    const key = (apiKey && String(apiKey).trim()) || process.env[p.envKey] || '';
    if (!key) {
      return res.status(400).json({
        error: `未配置 ${p.label} 的 API Key。请在服务端 .env 中设置 ${p.envKey}，或在浏览器设置中直接填写密钥（浏览器直连模式）。`,
      });
    }
    const modelName = (model && String(model).trim()) || p.model || process.env[p.envModel] || '';
    if (!modelName) return res.status(400).json({ error: '缺少模型名称' });

    const body = {
      model: modelName,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0.4,
      max_tokens: Math.min(maxTokens || 4096, 8192),
      stream: false,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const resp = await fetch(p.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data && (data.error && (data.error.message || data.error.code))) || `HTTP ${resp.status}`;
      return res.status(resp.status).json({ error: String(msg).slice(0, 500) });
    }
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') return res.status(502).json({ error: 'AI 返回内容异常' });
    return res.json({ content, model: data.model, usage: data.usage });
  } catch (e) {
    return res.status(500).json({ error: 'AI 请求失败：' + (e.message || e) });
  }
});

/* ---------------- health ---------------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, soffice: !!soffice, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[resume-ai-studio] listening on http://0.0.0.0:${PORT} (libreoffice: ${soffice || '未安装'})`);
});
