/* ============================================================
 * importers.js —— 导入：PDF 原样还原 / Word 转换 / Markdown / 项目 JSON
 *
 * PDF 还原原理：
 *   1) pdf.js 把每一页渲染成位图（100% 忠实原版）
 *   2) 提取文本坐标，生成"隐形"的可编辑文本层（透明文字，与原位图完全重叠）
 *   3) 提取页内图片，按变换矩阵精确对齐叠加（原位图区域被白底覆盖）
 *   4) 用户点击/拖动/编辑某元素时，该元素转为可见，并在其原始位置做白底覆盖
 * 这样保证：导入后与原版 100% 一致；任何文字、图片、分割线都可改可移。
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  const MM_PER_PT = 25.4 / 72;
  const BASE_DPI = 96; // 屏幕/导出基准

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  /* ================= 工具函数 ================= */
  function showLoading(text) { if (RS.ui) RS.ui.showLoading(text); }
  function hideLoading() { if (RS.ui) RS.ui.hideLoading(); }
  function toast(msg, type) { if (RS.ui) RS.ui.toast(msg, type); }

  const FONT_MAP = [
    [/SimSun|宋体|Song|MingLiU|PMingLiU|STSong|NSimSun/i, 'SimSun'],
    [/SimHei|黑体|Hei|Heiti|STHeiti|DengXian|MicrosoftYaHei|微软雅黑|雅黑|PingFang|SourceHanSans/i, 'Microsoft YaHei'],
    [/Kai|楷体|Kaiti|STKaiti/i, 'KaiTi'],
    [/Fang|仿宋|FangSong|STFangsong/i, 'FangSong'],
    [/Times|Liberation Serif|NimbusRoman/i, 'Times New Roman'],
    [/Arial|Helvetica|Helv|Liberation Sans|NimbusSans|ArialMT/i, 'Arial'],
    [/Calibri|Carlito/i, 'Calibri'],
    [/Georgia/i, 'Georgia'],
    [/Verdana/i, 'Verdana'],
    [/Courier|NimbusMono|Liberation Mono/i, 'Courier New'],
    [/Tahoma/i, 'Tahoma'],
    [/Trebuchet/i, 'Trebuchet MS'],
    [/Garamond/i, 'Garamond'],
    [/Consolas/i, 'Consolas'],
    [/Cambria/i, 'Cambria'],
    [/Frutiger/i, 'Frutiger'],
  ];

  // 文档字体表：WPS/Office 导出的 PDF 中 pdf.js 给文本的字体名是
  // "g_dX_fY" 子集别名（拿不到真实字体名），只能从 PDF 字节扫描 /BaseFont 还原。
  let docFonts = [];

  function stripSubset(name) {
    return String(name || '').replace(/^[A-Za-z0-9]{6}\+/, '');
  }
  function isSymbolFont(name) {
    return /Wingdings|ZapfDingbats|Dingbats|Symbol|MTExtra|Monotype|Marlett|Webdings/i.test(name);
  }
  function scanDocFonts(buffer) {
    docFonts = [];
    try {
      const bytes = new Uint8Array(buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      const re = /\/BaseFont\s*\/([^\s/>]+)/g;
      let m;
      const seen = {};
      while ((m = re.exec(s))) {
        const name = stripSubset(m[1]);
        if (!name || isSymbolFont(name)) continue;
        if (!seen[name]) { seen[name] = true; docFonts.push(name); }
      }
    } catch (e) { docFonts = []; }
  }

  function mapFont(fontName) {
    const out = { family: 'Microsoft YaHei', real: null, bold: false, italic: false };
    const n = String(fontName || '');
    // WPS 子集字体别名（g_dX_fY）：pdf.js 渲染位图时已把该字体的内嵌字形
    // 注册到 document.fonts（family 名 = 子集名）。直接用子集名做 font-family，
    // 编辑/导出时字形与底图 100% 一致；新输入的字符由字体栈回退到雅黑。
    const alias = n.match(/^g_\w+_f(\d+)$/i);
    if (alias) {
      const real = docFonts[parseInt(alias[1], 10) - 1];
      out.family = n;
      out.real = real || null;
      // 子集字体字形自带粗细/斜体，不再加 CSS weight（避免双重加粗）
      out.bold = false;
      out.italic = false;
      return out;
    }
    for (const [re, fam] of FONT_MAP) {
      if (re.test(n)) { out.family = fam; break; }
    }
    // 默认给宋体系，更贴近中英文简历正文
    if (!FONT_MAP.some(([re]) => re.test(n))) out.family = 'SimSun';
    if (/Bold|Heavy|Black|BoldItalic/i.test(n)) out.bold = true;
    if (/Italic|Oblique/i.test(n)) out.italic = true;
    return out;
  }

  /* 解析时收集检测到的原版真实字体名（供浮条下拉显示，如"等线/DengXian"） */
  const detectedFonts = [];
  function noteDetected(fm) { if (fm && fm.real && !detectedFonts.includes(fm.real)) detectedFonts.push(fm.real); }
  function getDetectedFonts() { return detectedFonts.slice(); }

  /* 导入新文档前清掉旧的内嵌字体注册（避免跨文档同名子集字体冲突） */
  function clearDocFonts() {
    try {
      if (document.fonts) {
        Array.from(document.fonts).forEach(f => {
          if (/^g_[A-Za-z0-9_]+$/i.test(f.family)) document.fonts.delete(f);
        });
      }
    } catch (e) {}
    detectedFonts.length = 0;
  }

  /* ================= PDF 导入 ================= */
  async function importPDF(file) {
    showLoading('正在解析 PDF，还原原版排版…');
    try {
      RS.historyReset();
      clearDocFonts(); // 清掉上一次导入的内嵌字体注册
      const data = await file.arrayBuffer();
      scanDocFonts(data); // 还原 WPS 子集字体名（g_dX_fY → 真实字体）
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const pages = [];
      let degraded = false;
      RS.render.clearCanvases();

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 }); // pt 坐标
        const pageW_mm = viewport.width * MM_PER_PT;
        const pageH_mm = viewport.height * MM_PER_PT;

        // 1) 渲染原版位图（按设备像素比提升清晰度）；渲染慢/失败时降级为纯文本编辑模式
        const DPR = Math.min(2.5, window.devicePixelRatio || 1);
        const cw = Math.max(1, Math.round(pageW_mm * BASE_DPI / 25.4 * DPR));
        const ch = Math.max(1, Math.round(pageH_mm * BASE_DPI / 25.4 * DPR));
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = cw; bgCanvas.height = ch;
        const renderScale = cw / viewport.width;
        const renderTask = page.render({ canvasContext: bgCanvas.getContext('2d'), viewport: page.getViewport({ scale: renderScale }) });
        const renderOk = await Promise.race([
          renderTask.promise.then(() => true),
          new Promise((r) => setTimeout(() => r(false), 20000)),
        ]);
        if (!renderOk) {
          try { renderTask.cancel(); } catch (e) {}
          degraded = true;
          console.warn('PDF 位图渲染超时，降级为纯文本编辑模式');
        }

        // 2) 提取文本 → 行元素
        const textContent = await page.getTextContent();
        const lineEls = textToElements(textContent.items, viewport, pageW_mm, pageH_mm);
        if (!renderOk) for (const el of lineEls) el.dirty = true; // 无底图时文字直接可见可编辑

        // 3) 提取图片元素
        let imgEls = [];
        try { imgEls = await extractImages(page, viewport, pageW_mm, pageH_mm); } catch (e) { console.warn('图片提取失败', e); }

        const elements = lineEls.concat(imgEls).sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const pageObj = { id: RS.uid('p'), w: pageW_mm, h: pageH_mm, elements, ghosts: [] };
        pages.push(pageObj);
        RS.render.setCanvas(pageObj.id, { bgOrig: bgCanvas, viewport, pdfPage: page, dpr: DPR });
      }

      RS.state.pages = pages;
      RS.state.pageW = pages[0] ? pages[0].w : 210;
      RS.state.pageH = pages[0] ? pages[0].h : 297;
      RS.state.projectName = (file.name || '简历').replace(/\.(pdf|docx|doc)$/i, '');
      RS.state.sourceInfo = { type: 'pdf', fileName: file.name };
      RS.state.selected = [];
      RS.render.renderAll();
      RS.commit();
      RS.render.fitWidth();
      hideLoading();
      toast(degraded
        ? '已导入 PDF，共 ' + pages.length + ' 页。当前环境位图渲染较慢，已切换为「纯文本编辑模式」——文字已全部可见可编辑，排版位置保持原版。'
        : '已导入 PDF，共 ' + pages.length + ' 页，与原版 100% 一致。点击任意文字/图片即可编辑移动。', degraded ? 'warn' : 'ok');
      if (RS.ui) { RS.ui.renderPagePane(); RS.ui.switchTab('style'); }
    } catch (e) {
      console.error(e);
      hideLoading();
      toast('PDF 解析失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  /* ---- 文本 → 行元素（高保真：大间隙拆段 + 行内混合样式富文本 + 按需补空格） ---- */
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function textToElements(items, viewport, pageW_mm, pageH_mm) {
    const pageH_pt = viewport.height;
    const recs = [];
    for (const it of items || []) {
      let str = it.str || '';
      if (!str.trim()) continue;
      // WPS/Office 导出的 PDF 常把列表符号放在私有区（Wingdings 等符号字体），
      // 浏览器没有这些字体，直接显示会成乱码方块 → 统一转成正常圆点
      str = str.replace(/[\ue000-\uf8ff]/g, '•');
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const x0 = t[4];
      const baselineTop_pt = pageH_pt - t[5]; // 基线到页面顶部的距离
      const size = it.height || 10;
      recs.push({
        x0, x1: x0 + (it.width || 0),
        baseline: baselineTop_pt,
        top: baselineTop_pt - size,
        size, fontName: it.fontName, hasEOL: !!it.hasEOL, str,
      });
    }
    recs.sort((a, b) => (a.baseline - b.baseline) || (a.x0 - b.x0));

    // 聚类成行：基线相近的归为一行
    const lines = [];
    let cur = null;
    for (const r of recs) {
      if (!cur || Math.abs(r.baseline - cur.baseline) > Math.max(2.5, r.size * 0.5) || r.hasEOL) {
        if (cur) lines.push(cur);
        cur = { baseline: r.baseline, size: r.size, items: [r] };
      } else {
        cur.items.push(r);
        cur.size = Math.max(cur.size, r.size);
      }
    }
    if (cur) lines.push(cur);

    const els = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.x0 - b.x0);
      // 按大间隙切段：间隙 > 0.8 字号视为独立文本块（如"电话 xxx 邮箱 xxx"），
      // 各自保留真实 x 定位，编辑/移动互不干扰，也避免合并成假空格
      const segs = [];
      let seg = null;
      for (const r of line.items) {
        if (!seg || r.x0 - seg.lastX1 > Math.max(r.size, seg.size) * 0.8) {
          if (seg) segs.push(seg);
          seg = { items: [r], lastX1: r.x1, baseline: r.baseline, size: r.size };
        } else {
          seg.items.push(r);
          seg.lastX1 = Math.max(seg.lastX1, r.x1);
          seg.size = Math.max(seg.size, r.size);
        }
      }
      if (seg) segs.push(seg);

      for (const s of segs) {
        s.items.sort((a, b) => a.x0 - b.x0);
        let text = '';
        let prevX1 = null;
        let pendingSpace = '';
        const richParts = [];
        for (const r of s.items) {
          if (prevX1 !== null) {
            const gap = r.x0 - prevX1;
            // 间隙按半个字宽折算空格数（一个空格 ≈ 0.45 字号），上限 4 个
            if (gap > r.size * 0.25) {
              const n = Math.max(1, Math.min(4, Math.round(gap / (r.size * 0.45))));
              pendingSpace = ' '.repeat(n);
            }
          }
          const fm = mapFont(r.fontName);
          // data-r 标记"解析原始富文本"，编辑时保护其样式不被剥离。
          // 只锁定字体族/加粗/斜体；字号不写死 → 由元素级字号统一控制（改字号即时全局生效）
          const st = 'font-family:' + fm.family + ';'
            + (fm.bold ? 'font-weight:700;' : '') + (fm.italic ? 'font-style:italic;' : '');
          richParts.push(pendingSpace + '<span data-r="1" style="' + st + '">' + escHtml(r.str) + '</span>');
          text += pendingSpace + r.str;
          pendingSpace = '';
          prevX1 = r.x1;
        }
        if (!text.trim()) continue;
        const first = s.items[0];
        const last = s.items[s.items.length - 1];
        const fm = mapFont(first.fontName);
        noteDetected(fm); // 收集原版真实字体名（浮条下拉显示用）
        const lineH_pt = s.size;
        els.push({
          type: 'text',
          text,
          rich: richParts.join(''),
          x: mm(first.x0), y: mm(s.baseline - lineH_pt),
          w: mm(last.x1 - first.x0), h: mm(lineH_pt),
          fontFamily: fm.family, fontReal: fm.real, fontSizePt: lineH_pt,
          bold: fm.bold, italic: fm.italic,
          color: '#000000',
          align: 'left', lineHeight: 1.25, letterSpacingPt: 0,
        });
      }
    }
    return els;
  }

  /* ---- 提取图片元素 ---- */
  async function extractImages(page, viewport, pageW_mm, pageH_mm) {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const out = [];
    const pageH_pt = viewport.height;
    const fn = opList.fnArray, args = opList.argsArray;

    for (let i = 0; i < fn.length; i++) {
      const op = fn[i];
      let imgObj = null, transform = null;
      if (op === OPS.paintImageXObject || op === OPS.paintJpegXObject) {
        const name = args[i][0];
        transform = args[i][1];
        if (!name) continue;
        try { imgObj = await page.objs.get(name); } catch (e) { continue; }
      } else if (op === OPS.paintInlineImageXObject) {
        imgObj = args[i][0];
        transform = args[i][1];
      } else {
        continue;
      }
      if (!imgObj || !imgObj.width || !imgObj.height) continue;
      if (!Array.isArray(transform) || transform.length < 6) continue;

      const m = transform;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [
        m[0] * u + m[2] * v + m[4],
        m[1] * u + m[3] * v + m[5],
      ]);
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w_mm = (x1 - x0) * MM_PER_PT, h_mm = (y1 - y0) * MM_PER_PT;
      if (w_mm < 0.8 || h_mm < 0.8) continue; // 忽略过小图形

      const src = await imageToDataURL(imgObj);
      if (!src) continue;
      out.push({
        type: 'image', src,
        x: mm(x0), y: mm(pageH_pt - y1),
        w: w_mm, h: h_mm,
        fit: 'fill', opacity: 1, rotation: 0,
      });
    }
    return out;
  }

  function imageToDataURL(imgObj) {
    return new Promise((resolve) => {
      try {
        const W = imgObj.width, H = imgObj.height;
        const data = imgObj.data;
        const len = data ? data.length : 0;
        let canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        // RGBA 位图
        if (len === W * H * 4) {
          const imgData = ctx.createImageData(W, H);
          imgData.data.set(new Uint8ClampedArray(data.buffer || data));
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
          return;
        }
        // JPEG / PNG 压缩流
        const isJpeg = data[0] === 0xFF && data[1] === 0xD8;
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        if (isJpeg || isPng) {
          const blob = new Blob([data], { type: isJpeg ? 'image/jpeg' : 'image/png' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, W, H);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = () => resolve(null);
          img.src = url;
          return;
        }
        resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function mm(pt) { return pt * MM_PER_PT; }

  /* ================= Word 导入 ================= */
  async function importDOCX(file) {
    showLoading('正在转换 Word 简历…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/convert', { method: 'POST', body: fd });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        const pdfFile = new File([buf], file.name.replace(/\.(docx|doc)$/i, '.pdf'), { type: 'application/pdf' });
        await importPDF(pdfFile);
        RS.state.sourceInfo = { type: 'docx', fileName: file.name };
        return;
      }
      const errData = await r.json().catch(() => ({}));
      if (!errData.fallback) {
        throw new Error(errData.error || ('HTTP ' + r.status));
      }
      // 服务器无 LibreOffice → 浏览器端渲染
    } catch (e) {
      console.warn('服务端转换不可用，回退浏览器渲染：', e.message);
    }
    await importDOCXClient(file);
  }

  const EMU_PER_MM = 36000;
  const emu2mm = (v) => v / EMU_PER_MM;

  /* 自研 docx XML 解析：支持 Word 文本框(wps:txbx)、普通段落、表格、图片、组合形状的绝对坐标重建。
     服务器有 LibreOffice 时走服务端精确转换；此解析器保证无 LibreOffice 环境（如纯静态部署）也能还原。 */
  async function parseDocxXml(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlEntry = zip.file('word/document.xml');
    if (!docXmlEntry) throw new Error('document.xml not found');
    const docXml = await docXmlEntry.async('string');
    const relsEntry = zip.file('word/_rels/document.xml.rels');
    const relsXml = relsEntry ? await relsEntry.async('string') : '';
    const dp = new DOMParser();
    const doc = dp.parseFromString(docXml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('xml parse error');
    const rels = {};
    if (relsXml) {
      const rd = dp.parseFromString(relsXml, 'application/xml');
      for (const rel of rd.getElementsByTagName('Relationship')) {
        rels[rel.getAttribute('Id')] = rel.getAttribute('Target') || '';
      }
    }
    const body = doc.getElementsByTagName('w:body')[0] || doc.getElementsByTagName('body')[0];
    if (!body) throw new Error('no body');

    // 页面尺寸（sectPr 中 pgSz，单位 twips）
    let pageW = 210, pageH = 297;
    const pgSz = doc.getElementsByTagName('w:pgSz')[0];
    if (pgSz) {
      const wTw = parseFloat(pgSz.getAttribute('w:w') || '0');
      const hTw = parseFloat(pgSz.getAttribute('w:h') || '0');
      if (wTw > 100) pageW = wTw / 1440 * 25.4;
      if (hTw > 100) pageH = hTw / 1440 * 25.4;
    }

    const elements = [];
    const mm = (v) => Math.round((v / EMU_PER_MM) * 1000) / 1000;

    function paraStyle(p) {
      const pPr = p.getElementsByTagName('w:pPr')[0];
      const st = { align: 'left', lineH: null, lineRule: 'auto', before: 0, after: 0, indL: 0 };
      if (pPr) {
        const jc = pPr.getElementsByTagName('w:jc')[0];
        if (jc) st.align = jc.getAttribute('w:val') || 'left';
        const sp = pPr.getElementsByTagName('w:spacing')[0];
        if (sp) {
          const line = sp.getAttribute('w:line');
          const rule = sp.getAttribute('w:lineRule') || 'auto';
          if (line) {
            st.lineRule = rule;
            // exact/atLeast：绝对磅值；auto：240 分之一行（字号倍数）
            st.lineH = rule === 'exact' || rule === 'atLeast' ? parseFloat(line) / 20 : parseFloat(line) / 240;
          }
          const before = sp.getAttribute('w:before');
          if (before) st.before = parseFloat(before) / 20; // twips → pt
          const after = sp.getAttribute('w:after');
          if (after) st.after = parseFloat(after) / 20;
        }
        const ind = pPr.getElementsByTagName('w:ind')[0];
        if (ind) st.indL = (parseFloat(ind.getAttribute('w:left') || ind.getAttribute('w:start') || '0') || 0) / 20;
      }
      return st;
    }

    // 段落行高（mm）：absolute=磅值，multiplier=字号倍数
    function lineHmm(ps, fontSizePt) {
      if (ps.lineH == null) return fontSizePt * 1.25 * MM_PER_PT;
      if (ps.lineRule === 'exact' || ps.lineRule === 'atLeast') return ps.lineH * MM_PER_PT;
      return fontSizePt * ps.lineH * MM_PER_PT;
    }

    function runStyle(r) {
      const rPr = r.getElementsByTagName('w:rPr')[0];
      const st = { text: '', font: '', size: 11, color: '000000', bold: false, italic: false, underline: false };
      for (const child of Array.from(r.childNodes)) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 't') st.text += child.textContent || '';
        else if (child.localName === 'tab') st.text += '    ';
        else if (child.localName === 'br') st.text += '\n';
      }
      if (rPr) {
        const rf = rPr.getElementsByTagName('w:rFonts')[0];
        if (rf) st.font = rf.getAttribute('w:eastAsia') || rf.getAttribute('w:ascii') || '';
        const sz = rPr.getElementsByTagName('w:sz')[0];
        if (sz) st.size = parseFloat(sz.getAttribute('w:val')) / 2;
        const col = rPr.getElementsByTagName('w:color')[0];
        if (col) st.color = (col.getAttribute('w:val') || '000000').replace(/^#/, '');
        if (rPr.getElementsByTagName('w:b')[0]) st.bold = true;
        if (rPr.getElementsByTagName('w:i')[0]) st.italic = true;
        if (rPr.getElementsByTagName('w:u')[0]) st.underline = true;
      }
      return st;
    }

    function paraRunsText(p) {
      const runs = [];
      for (const r of p.getElementsByTagName('w:r')) runs.push(runStyle(r));
      return runs;
    }

    function wrapText(text, fontFamily, sizePt, maxWmm) {
      if (maxWmm <= 2) return text.split('\n');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const px = sizePt * 96 / 72;
      ctx.font = `${px}px ${fontFamily}, sans-serif`;
      const mmOf = (wpx) => wpx / 3.7795275591;
      const lines = [];
      let cur = '';
      for (const ch of text) {
        if (ch === '\n') { lines.push(cur.trim() || ' '); cur = ''; continue; }
        const test = cur + ch;
        if (cur && mmOf(ctx.measureText(test).width) > maxWmm) { lines.push(cur.trim() || ' '); cur = ch; }
        else cur = test;
      }
      lines.push(cur.trim() || ' ');
      return lines;
    }

    function pushTextEl(x, y, w, h, runs, align, lhMm, indL) {
      const merged = runs;
      if (!merged.length) return;
      const first = merged[0];
      const text = merged.map(r => r.text).join('');
      if (!text.trim()) return;
      const family = mapFont(first.font || '').family;
      const lines = wrapText(text, family, first.size, Math.max(w, 4));
      const el = {
        type: 'text',
        text: lines.join('\n'),
        x: Math.round((x + indL) * 100) / 100,
        y: Math.round(y * 100) / 100,
        w: Math.round(w * 100) / 100,
        h: Math.round(lines.length * lhMm * 100) / 100,
        fontFamily: family,
        fontSizePt: first.size,
        bold: first.bold,
        italic: first.italic,
        underline: first.underline,
        color: '#' + (first.color.length === 6 ? first.color : '000000'),
        align: ({ left: 'left', right: 'right', center: 'center', both: 'justify', distribute: 'justify' })[align] || 'left',
        lineHeight: lhMm / (first.size * MM_PER_PT),
      };
      elements.push(el);
      return el;
    }

    // 文本框内容 → 绝对定位文本元素
    function emitTextBox(wsp, bx, by, bw, bh) {
      const txbx = wsp.getElementsByTagName('wps:txbx')[0];
      const content = txbx ? txbx.getElementsByTagName('w:txbxContent')[0] : null;
      if (!content) return;
      const bodyPr = wsp.getElementsByTagName('wps:bodyPr')[0];
      const lIns = bodyPr ? emu2mm(parseFloat(bodyPr.getAttribute('lIns') || '91440')) : 2.54;
      const tIns = bodyPr ? emu2mm(parseFloat(bodyPr.getAttribute('tIns') || '45720')) : 1.27;
      const rIns = bodyPr ? emu2mm(parseFloat(bodyPr.getAttribute('rIns') || '91440')) : 2.54;
      const bIns = bodyPr ? emu2mm(parseFloat(bodyPr.getAttribute('bIns') || '45720')) : 1.27;
      const anchorV = bodyPr ? (bodyPr.getAttribute('anchor') || 't') : 't';
      const textX = bx + lIns;
      const textW = Math.max(bw - lIns - rIns, 4);
      let ty = by + tIns;
      const paras = [];
      for (const p of content.getElementsByTagName('w:p')) {
        const runs = paraRunsText(p);
        if (!runs.filter(r => r.text.trim()).length) continue;
        const ps = paraStyle(p);
        const first = runs.find(r => r.text.trim()) || runs[0];
        const family = mapFont(first.font || '').family;
        const lines = wrapText(runs.map(r => r.text).join(''), family, first.size, textW);
        const lhMm = lineHmm(ps, first.size);
        const paraH = lines.length * lhMm + ps.before * MM_PER_PT + ps.after * MM_PER_PT;
        paras.push({ runs, ps, lines, first, lhMm, paraH, y: ty + ps.before * MM_PER_PT });
        ty += paraH;
      }
      // 垂直对齐补偿
      const estH = ty - by - tIns;
      let vShift = 0;
      if (anchorV === 'ctr') vShift = Math.max(0, (bh - estH - bIns) / 2);
      else if (anchorV === 'b') vShift = Math.max(0, bh - estH - bIns);
      for (const pa of paras) {
        pushTextEl(textX, pa.y + vShift, textW, pa.lines.length * pa.lhMm, pa.runs, pa.ps.align, pa.lhMm, pa.ps.indL);
      }
    }

    // 提取图片（blip → media → dataURL）
    function extractImage(blip) {
      if (!blip) return Promise.resolve(null);
      const rid = blip.getAttribute('r:embed');
      if (!rid || !rels[rid]) return Promise.resolve(null);
      const target = rels[rid].replace(/^\.?\//, '');
      const full = target.startsWith('word/') ? target : 'word/' + target;
      const entry = zip.file(full) || zip.file(target);
      if (!entry) return Promise.resolve(null);
      return entry.async('base64').then(b64 => {
        const ext = (full.split('.').pop() || '').toLowerCase();
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext] || 'image/png';
        return { src: 'data:' + mime + ';base64,' + b64 };
      });
    }

    // 遍历一组形状（wpg:wgp 组合 / 直接 wsp / w:pic）
    async function processShapes(scope, ax, ay) {
      const pending = [];
      for (const wsp of scope.getElementsByTagName('wps:wsp')) {
        const xfrm = wsp.getElementsByTagName('a:xfrm')[0];
        const off = xfrm ? xfrm.getElementsByTagName('a:off')[0] : null;
        const ext = xfrm ? xfrm.getElementsByTagName('a:ext')[0] : null;
        const sx = off ? emu2mm(parseFloat(off.getAttribute('x') || '0')) : 0;
        const sy = off ? emu2mm(parseFloat(off.getAttribute('y') || '0')) : 0;
        let sw = ext ? emu2mm(parseFloat(ext.getAttribute('cx') || '0')) : 0;
        let sh = ext ? emu2mm(parseFloat(ext.getAttribute('cy') || '0')) : 0;
        if (!sw && !sh) {
          const e = wsp.getElementsByTagName('wp:extent')[0];
          if (e) { sw = emu2mm(parseFloat(e.getAttribute('cx') || '0')); sh = emu2mm(parseFloat(e.getAttribute('cy') || '0')); }
        }
        if (!sw || !sh) continue;
        const txbx = wsp.getElementsByTagName('wps:txbx')[0];
        if (txbx) {
          emitTextBox(wsp, ax + sx, ay + sy, sw, sh);
          continue;
        }
        const blip = wsp.getElementsByTagName('a:blip')[0];
        if (blip) {
          pending.push(extractImage(blip, null).then(p => {
            if (p) elements.push({ type: 'image', x: Math.round((ax + sx) * 100) / 100, y: Math.round((ay + sy) * 100) / 100, w: Math.round(sw * 100) / 100, h: Math.round(sh * 100) / 100, src: p.src });
          }));
        }
      }
      for (const pic of scope.getElementsByTagName('pic:pic')) {
        const spPr = pic.getElementsByTagName('pic:spPr')[0] || pic.getElementsByTagName('w:spPr')[0];
        const xfrm = (spPr ? spPr.getElementsByTagName('a:xfrm')[0] : null) || pic.getElementsByTagName('wp:xfrm')[0];
        const off = xfrm ? xfrm.getElementsByTagName('a:off')[0] : null;
        const ext = xfrm ? xfrm.getElementsByTagName('a:ext')[0] : null;
        const sx = off ? emu2mm(parseFloat(off.getAttribute('x') || '0')) : 0;
        const sy = off ? emu2mm(parseFloat(off.getAttribute('y') || '0')) : 0;
        let sw = ext ? emu2mm(parseFloat(ext.getAttribute('cx') || '0')) : 0;
        let sh = ext ? emu2mm(parseFloat(ext.getAttribute('cy') || '0')) : 0;
        if (!sw && !sh) {
          const e = pic.getElementsByTagName('wp:extent')[0];
          if (e) { sw = emu2mm(parseFloat(e.getAttribute('cx') || '0')); sh = emu2mm(parseFloat(e.getAttribute('cy') || '0')); }
        }
        if (!sw || !sh) continue;
        const blip = pic.getElementsByTagName('a:blip')[0];
        if (blip) {
          pending.push(extractImage(blip).then(p => {
            if (p) elements.push({ type: 'image', x: Math.round((ax + sx) * 100) / 100, y: Math.round((ay + sy) * 100) / 100, w: Math.round(sw * 100) / 100, h: Math.round(sh * 100) / 100, src: p.src });
          }));
        }
      }
      await Promise.all(pending);
    }

    // 锚定形状（文本框/图片）
    const anchors = Array.from(doc.getElementsByTagName('wp:anchor'));
    for (const a of anchors) {
      const posH = a.getElementsByTagName('wp:positionH')[0];
      const posV = a.getElementsByTagName('wp:positionV')[0];
      const xOff = posH ? parseFloat((posH.getElementsByTagName('wp:posOffset')[0] || {}).textContent || '0') : 0;
      const yOff = posV ? parseFloat((posV.getElementsByTagName('wp:posOffset')[0] || {}).textContent || '0') : 0;
      const ax = emu2mm(xOff);
      const ay = emu2mm(yOff);
      const gd = a.getElementsByTagName('a:graphicData')[0];
      if (gd) await processShapes(gd, ax, ay);
    }

    // 普通段落顺序排版（非文本框文档）
    if (elements.length === 0) {
      let flowY = 0;
      const flowEls = [];
      for (const child of Array.from(body.childNodes)) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 'p') {
          const runs = paraRunsText(child);
          if (!runs.filter(r => r.text.trim()).length) { flowY += 4 * MM_PER_PT; continue; }
          const ps = paraStyle(child);
          const first = runs.find(r => r.text.trim()) || runs[0];
          const family = mapFont(first.font || '').family;
          const lines = wrapText(runs.map(r => r.text).join(''), family, first.size, pageW - 24);
          const lhMm = lineHmm(ps, first.size);
          const el = pushTextEl(12, flowY, pageW - 24, lines.length * lhMm, runs, ps.align, lhMm, ps.indL);
          flowY += lines.length * lhMm + ps.before * MM_PER_PT + ps.after * MM_PER_PT + 2 * MM_PER_PT;
          if (el) flowEls.push(el);
        } else if (child.localName === 'tbl') {
          const cellTexts = [];
          for (const tc of child.getElementsByTagName('w:tc')) {
            const t = (tc.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) cellTexts.push(t);
          }
          if (cellTexts.length) {
            const el = pushTextEl(12, flowY, pageW - 24, 8, [{ text: ' | '.join(cellTexts), size: 11, color: '000000' }], 'left', 11 * 1.25 * MM_PER_PT, 0);
            flowY += 12 * MM_PER_PT;
          }
        } else if (child.localName === 'sectPr') {
          // 忽略
        }
      }
    }

    // 分页
    const pages = [];
    const getPage = (idx) => {
      while (pages.length <= idx) pages.push({ id: RS.uid('p'), w: pageW, h: pageH, elements: [], ghosts: [], noCanvas: true });
      return pages[idx];
    };
    for (const el of elements) {
      const pageIdx = Math.max(0, Math.floor(el.y / pageH));
      const page = getPage(pageIdx);
      const copy = { ...el, y: Math.round((el.y - pageIdx * pageH) * 100) / 100 };
      page.elements.push(copy);
    }
    if (!pages.length) getPage(0);
    return { pages, pageW, pageH };
  }

  /* 浏览器端 docx 渲染（docx-preview），忠实度较高，随后摊平为可编辑元素 */
  async function importDOCXClient(file) {
    showLoading('浏览器端渲染 Word（若服务器装有 LibreOffice 将获得 100% 精确还原）…');
    try {
      const buf = await file.arrayBuffer();

      // 通道 1：自研 docx XML 解析（文本框简历必须走此通道，docx-preview 不支持文本框）
      try {
        const parsed = await parseDocxXml(buf);
        if (parsed && parsed.pages[0] && parsed.pages[0].elements.length > 0) {
          const pages = parsed.pages;
          RS.historyReset();
          RS.render.clearCanvases();
          RS.state.pages = pages;
          RS.state.pageW = parsed.pageW;
          RS.state.pageH = parsed.pageH;
          RS.state.projectName = (file.name || '简历').replace(/\.(docx|doc)$/i, '');
          RS.state.sourceInfo = { type: 'docx', fileName: file.name, clientRender: true, xmlParse: true };
          RS.state.selected = [];
          RS.render.renderAll();
          RS.commit();
          RS.render.fitWidth();
          hideLoading();
          toast('已通过 Word 原生解析还原（支持文本框精确排版）');
          return;
        }
      } catch (err) {
        console.warn('docx xml 解析失败，尝试 docx-preview：', err.message);
      }

      // 通道 2：docx-preview 渲染摊平
      const container = document.createElement('div');
      container.id = 'docx-render';
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;background:#fff;';
      document.body.appendChild(container);

      await window.docx.renderAsync(buf, container, null, {
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: false,
        renderHeaders: false,
        renderFooters: false,
      });
      await new Promise(r => setTimeout(r, 60));

      const blocks = collectBlocks(container);
      const pageW = 210, pageH = 297;
      const cRect = container.getBoundingClientRect();
      const scaleMM = pageW / cRect.width;

      const pages = [];
      let curPage = null;
      const ensurePage = (idx) => {
        while (pages.length <= idx) {
          const p = { id: RS.uid('p'), w: pageW, h: pageH, elements: [], ghosts: [], noCanvas: true };
          pages.push(p);
        }
        curPage = pages[idx];
      };
      ensurePage(0);

      for (const b of blocks) {
        const r = b.node.getBoundingClientRect();
        const x = (r.left - cRect.left) * scaleMM;
        const y = (r.top - cRect.top) * scaleMM;
        const w = r.width * scaleMM;
        const h = r.height * scaleMM;
        if (w < 0.3 || h < 0.3) continue;
        const pageIdx = Math.min(pages.length - 1, Math.floor(y / pageH));
        ensurePage(pageIdx);
        const py = y - pageIdx * pageH;
        const cs = getComputedStyle(b.node);

        if (b.type === 'text') {
          const fm = mapFont(cs.fontFamily);
          const sizePt = parseFloat(cs.fontSize) || 10;
          const align = ({ left: 'left', right: 'right', center: 'center', justify: 'justify' })[cs.textAlign] || 'left';
          curPage.elements.push({
            type: 'text',
            text: b.node.textContent.replace(/\u00a0/g, ' ').replace(/\n+/g, '\n'),
            x, y: py, w: Math.min(w, pageW - 10), h: h || sizePt * MM_PER_PT * 1.4,
            fontFamily: fm.family, fontSizePt: sizePt,
            bold: b.node.matches('b,strong') || parseInt(cs.fontWeight) >= 600,
            italic: !!cs.fontStyle && cs.fontStyle !== 'normal',
            color: rgbToHex(cs.color),
            align, lineHeight: parseFloat(cs.lineHeight) || 1.4, letterSpacingPt: 0,
          });
        } else if (b.type === 'img') {
          const src = await imgElToDataURL(b.node);
          if (src) curPage.elements.push({ type: 'image', src, x, y: py, w: Math.min(w, pageW - 10), h, fit: 'fill', opacity: 1, rotation: 0 });
        } else if (b.type === 'table' || b.type === 'list' || b.type === 'html') {
          curPage.elements.push({ type: 'html', html: b.node.outerHTML, x, y: py, w: Math.min(w, pageW - 10), h, color: '#000' });
        }
      }
      container.remove();

      if (!pages[0].elements.length) throw new Error('未能从文档中解析出内容');
      RS.historyReset();
      RS.render.clearCanvases();
      RS.state.pages = pages;
      RS.state.pageW = pageW;
      RS.state.pageH = pageH;
      RS.state.projectName = (file.name || '简历').replace(/\.(docx|doc)$/i, '');
      RS.state.sourceInfo = { type: 'docx', fileName: file.name, clientRender: true };
      RS.state.selected = [];
      RS.render.renderAll();
      RS.commit();
      RS.render.fitWidth();
      hideLoading();
      toast('已导入 Word（浏览器端渲染）。提示：部署环境中服务器带 LibreOffice，将获得与 Word 完全一致的精确还原。', 'warn');
      if (RS.ui) { RS.ui.renderPagePane(); RS.ui.switchTab('style'); }
    } catch (e) {
      console.error(e);
      hideLoading();
      toast('Word 解析失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  function collectBlocks(root) {
    const out = [];
    const pushed = new Set();
    const hasDirectText = (el) => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    function walk(node) {
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD' || tag === 'TITLE') return;
      if (tag === 'IMG') { if (!pushed.has(node)) { pushed.add(node); out.push({ type: 'img', node }); } return; }
      if (tag === 'TABLE') { if (!pushed.has(node)) { pushed.add(node); out.push({ type: 'table', node }); } return; }
      if (tag === 'UL' || tag === 'OL') { if (!pushed.has(node)) { pushed.add(node); out.push({ type: 'list', node }); } return; }
      if (hasDirectText(node) && (node.textContent || '').trim()) {
        out.push({ type: 'text', node }); // 可能嵌套更深文本持有者，收集后过滤
      }
      for (const ch of Array.from(node.childNodes)) walk(ch);
    }
    walk(root);
    // 只保留最深的文本持有者（不被其他记录节点包含）
    return out.filter(b => !out.some(o => o !== b && o.node !== b.node && o.node.contains(b.node)));
  }

  function rgbToHex(rgb) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(rgb || '');
    if (!m) return '#000000';
    const to = v => Math.max(0, Math.min(255, Math.round(parseFloat(v)))).toString(16).padStart(2, '0');
    return '#' + to(m[1]) + to(m[2]) + to(m[3]);
  }

  function imgElToDataURL(img) {
    return new Promise((resolve) => {
      try {
        let src = img.currentSrc || img.src;
        if (src.startsWith('blob:')) {
          fetch(src).then(r => r.blob()).then(blob => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          }).catch(() => resolve(null));
        } else resolve(src);
      } catch (e) { resolve(null); }
    });
  }

  /* ================= Markdown 导入 ================= */
  function importMarkdown(md, templateKey) {
    const result = RS.layoutMarkdown(md, templateKey);
    RS.historyReset();
    RS.render.clearCanvases();
    RS.state.pages = result.pages;
    RS.state.pageW = result.pageW;
    RS.state.pageH = result.pageH;
    RS.state.projectName = 'Markdown 简历';
    RS.state.sourceInfo = { type: 'md', template: templateKey };
    RS.state.selected = [];
    RS.state.template = RS.templates[templateKey] || RS.templates.classic;
    RS.render.renderAll();
    RS.commit();
    RS.render.fitWidth();
    if (RS.ui) { RS.ui.renderPagePane(); RS.ui.switchTab('style'); }
    return result;
  }

  /* ================= 项目 JSON ================= */
  function exportProjectJSON() {
    const data = {
      app: 'resume-ai-studio',
      version: 1,
      projectName: RS.state.projectName,
      pageW: RS.state.pageW,
      pageH: RS.state.pageH,
      sourceInfo: RS.state.sourceInfo,
      pages: RS.state.pages,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (RS.state.projectName || '简历') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importProjectJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.pages)) throw new Error('项目文件格式不正确');
    if (data.app && data.app !== 'resume-ai-studio') throw new Error('不是本工具生成的项目文件');
    RS.restoreSnapshot(data);
    return data;
  }

  RS.importers = {
    importPDF,
    importDOCX,
    importDOCXClient,
    parseDocxXml,
    importMarkdown,
    exportProjectJSON,
    importProjectJSON,
    textToElements,
    extractImages,
    mapFont,
    getDetectedFonts,
    clearDocFonts,
  };
})();
