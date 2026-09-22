/* ============================================================
 * exporters.js —— 导出：PDF(打印) / PNG / Word / Markdown / 结构提取
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  const MM2PX = 96 / 25.4;
  const printRoot = document.getElementById('printRoot');

  /* ---------- 通用：构建导出页 DOM（不画背景位图，元素真实可见） ---------- */
  function buildExportPage(page) {
    const w = page.w || RS.state.pageW;
    const h = page.h || RS.state.pageH;
    const div = document.createElement('div');
    div.className = 'exp-page';
    div.style.cssText = 'width:' + w + 'mm;height:' + h + 'mm;position:relative;overflow:hidden;background:#fff;';
    for (const el of RS.byZ(page.elements)) {
      if (el.type === 'text' && !(el.text || '').trim() && !el.html) continue;
      div.appendChild(buildExportEl(el));
    }
    return div;
  }

  function buildExportEl(el) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:' + el.x + 'mm;top:' + el.y + 'mm;width:' + el.w + 'mm;height:' + el.h + 'mm;';
    if (el.rotation) d.style.transform = 'rotate(' + el.rotation + 'deg)';
    if (typeof el.opacity === 'number' && el.opacity < 1) d.style.opacity = el.opacity;

    if (el.type === 'text') {
      const span = document.createElement('span');
      span.innerHTML = RS.render.textToHTML(el.text);
      span.style.fontFamily = RS.render.fontStack(el.fontFamily);
      span.style.fontSize = (el.fontSizePt || 10) + 'pt';
      if (el.bold) span.style.fontWeight = '700';
      if (el.italic) span.style.fontStyle = 'italic';
      if (el.underline) span.style.textDecoration = 'underline';
      span.style.color = el.color || '#000';
      span.style.textAlign = el.align || 'left';
      span.style.lineHeight = (el.lineHeight || 1.25);
      if (el.letterSpacingPt) span.style.letterSpacing = el.letterSpacingPt + 'pt';
      if (el.bgColor) { span.style.background = el.bgColor; span.style.display = 'block'; span.style.padding = '1px 3px'; }
      d.appendChild(span);
    } else if (el.type === 'image') {
      const img = document.createElement('img');
      img.src = el.src;
      img.style.cssText = 'width:100%;height:100%;object-fit:' + (el.fit === 'contain' ? 'contain' : 'fill') + ';';
      d.appendChild(img);
    } else if (el.type === 'divider') {
      const l = document.createElement('div');
      l.style.cssText = 'width:100%;height:' + (el.thickness || 1) + 'px;background:' + (el.color || '#000') + ';';
      if (el.dash) { l.style.background = 'none'; l.style.borderTop = (el.thickness || 1) + 'px dashed ' + (el.color || '#000'); }
      d.appendChild(l);
    } else if (el.type === 'shape') {
      d.style.background = el.fill || 'transparent';
      d.style.border = (el.borderWidth || 0) + 'px solid ' + (el.borderColor || '#000');
      if (el.shapeType === 'ellipse') d.style.borderRadius = '50%';
      else if (el.radius) d.style.borderRadius = el.radius + 'mm';
    } else if (el.type === 'html') {
      d.innerHTML = el.html || '';
    }
    return d;
  }

  /* ---------- 导出 PDF（浏览器打印 → 另存为 PDF，矢量文字） ---------- */
  function exportPDF() {
    if (!RS.state.pages.length) { RS.ui.toast('当前没有可导出的简历', 'warn'); return; }
    printRoot.innerHTML = '';
    const sizeTag = document.getElementById('rs-page-size');
    if (sizeTag) sizeTag.remove();
    const pages = RS.state.pages;
    const st = document.createElement('style');
    st.id = 'rs-page-size';
    const w = pages[0].w || RS.state.pageW, h = pages[0].h || RS.state.pageH;
    st.textContent = '@page { size: ' + w + 'mm ' + h + 'mm; margin: 0; }';
    document.head.appendChild(st);

    for (const p of pages) printRoot.appendChild(buildExportPage(p));
    const oldTitle = document.title;
    document.title = (RS.state.projectName || '简历');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        printRoot.innerHTML = '';
        document.title = oldTitle;
        st.remove();
      }, 1500);
    }, 120);
    RS.ui.toast('请在打印对话框中选择「另存为 PDF」', 'ok');
  }

  /* ---------- 导出 PNG ---------- */
  async function pageToCanvas(page) {
    const node = buildExportPage(page);
    node.style.position = 'absolute';
    node.style.left = '-9999px';
    document.body.appendChild(node);
    try {
      const canvas = await html2canvas(node, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true });
      return canvas;
    } finally {
      node.remove();
    }
  }

  async function exportPNG(separate) {
    if (!RS.state.pages.length) { RS.ui.toast('当前没有可导出的简历', 'warn'); return; }
    RS.ui.showLoading('正在生成图片…');
    try {
      const canvases = [];
      for (const p of RS.state.pages) canvases.push(await pageToCanvas(p));
      if (separate) {
        canvases.forEach((cv, i) => {
          const url = cv.toDataURL('image/png');
          downloadDataURL(url, (RS.state.projectName || '简历') + '-第' + (i + 1) + '页.png');
        });
        RS.ui.toast('已导出 ' + canvases.length + ' 张页面 PNG', 'ok');
      } else {
        const width = Math.max(...canvases.map(c => c.width));
        const height = canvases.reduce((s, c) => s + c.height, 0);
        const big = document.createElement('canvas');
        big.width = width; big.height = height;
        const ctx = big.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        let y = 0;
        for (const c of canvases) {
          ctx.drawImage(c, Math.round((width - c.width) / 2), y);
          y += c.height;
        }
        downloadDataURL(big.toDataURL('image/png'), (RS.state.projectName || '简历') + '-长图.png');
        RS.ui.toast('已导出长图 PNG', 'ok');
      }
    } catch (e) {
      console.error(e);
      RS.ui.toast('图片导出失败：' + e.message, 'err');
    } finally {
      RS.ui.hideLoading();
    }
  }

  function downloadDataURL(dataURL, name) {
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = name;
    a.click();
  }

  /* ---------- 导出 Word（.doc，Word 兼容 HTML，绝对定位保留版式） ---------- */
  function exportWord() {
    if (!RS.state.pages.length) { RS.ui.toast('当前没有可导出的简历', 'warn'); return; }
    const parts = [];
    parts.push('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">');
    parts.push('<head><meta charset="utf-8"><title>' + esc(RS.state.projectName || '简历') + '</title>');
    parts.push('<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->');
    parts.push('<style>body{margin:0;padding:0;} @page{margin:0;} .rs-page{position:relative;overflow:hidden;page-break-after:always;background:#fff;}</style>');
    parts.push('</head><body>');
    for (const p of RS.state.pages) {
      const w = p.w || RS.state.pageW, h = p.h || RS.state.pageH;
      parts.push('<div class="rs-page" style="width:' + w + 'mm;height:' + h + 'mm;">');
      for (const el of RS.byZ(p.elements)) parts.push(wordEl(el));
      parts.push('</div>');
    }
    parts.push('</body></html>');
    const blob = new Blob(['\ufeff' + parts.join('')], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (RS.state.projectName || '简历') + '.doc';
    a.click();
    URL.revokeObjectURL(url);
    RS.ui.toast('已导出 Word（.doc，用 Microsoft Word / WPS 打开）', 'ok');
  }

  function wordEl(el) {
    const css = ['position:absolute', 'left:' + el.x + 'mm', 'top:' + el.y + 'mm', 'width:' + el.w + 'mm', 'height:' + el.h + 'mm'];
    if (el.rotation) css.push('transform:rotate(' + el.rotation + 'deg)');
    let inner = '';
    if (el.type === 'text') {
      css.push('font-family:' + (el.fontFamily ? '"' + el.fontFamily + '"' : '"SimSun"'));
      css.push('font-size:' + (el.fontSizePt || 10) + 'pt');
      if (el.bold) css.push('font-weight:bold');
      if (el.italic) css.push('font-style:italic');
      if (el.underline) css.push('text-decoration:underline');
      css.push('color:' + (el.color || '#000'));
      css.push('text-align:' + (el.align || 'left'));
      css.push('line-height:' + (el.lineHeight || 1.25));
      inner = esc(el.text || '').replace(/\n/g, '<br>');
    } else if (el.type === 'image') {
      inner = '<img src="' + el.src + '" style="width:100%;height:100%;">';
    } else if (el.type === 'divider') {
      inner = '<div style="width:100%;height:' + (el.thickness || 1) + 'px;background:' + (el.color || '#000') + ';"></div>';
    } else if (el.type === 'shape') {
      inner = '<div style="width:100%;height:100%;background:' + (el.fill || 'transparent') + ';border:' + (el.borderWidth || 0) + 'px solid ' + (el.borderColor || '#000') + ';"></div>';
    } else if (el.type === 'html') {
      inner = el.html || '';
    }
    return '<div style="' + css.join(';') + ';">' + inner + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 简历语义结构（AI 与 Markdown 导出共用） ---------- */
  function buildResumeStructure(maxChars) {
    const els = RS.allElements().filter(e => e.type === 'text' && e.text && e.text.trim());
    els.sort((a, b) => {
      const pi = RS.pageIndex(a.page) - RS.pageIndex(b.page);
      return pi !== 0 ? pi : ((a.y - b.y) || (a.x - b.x));
    });
    const sizes = els.map(e => e.fontSizePt || 10).sort((a, b) => a - b);
    const med = sizes[Math.floor(sizes.length / 2)] || 10;
    const SECTION_RE = /^(教育背景|工作经历|实习经历|项目经历|项目经验|技能特长|专业技能|技能|荣誉|获奖|证书|自我评价|个人总结|求职意向|个人信息|基本信息|联系方式|校园经历|社会实践|科研经历|论文|著作|培训经历|语言能力|兴趣爱好)/;
    const sections = [];
    let cur = null;
    for (const e of els) {
      const t = e.text.trim();
      const isHead = t.length <= 26 && ((e.bold && (e.fontSizePt || 10) > med + 1) || SECTION_RE.test(t));
      if (isHead) {
        cur = { title: t, lines: [] };
        sections.push(cur);
      } else {
        if (!cur) { cur = { title: '基本信息', lines: [] }; sections.push(cur); }
        cur.lines.push({ id: e.id, text: t });
      }
    }
    // 控制 token 量
    let total = 0;
    const cap = maxChars || 8000;
    const out = [];
    for (const s of sections) {
      let head = '## ' + s.title;
      let lines = s.lines;
      if (total + head.length + 20 > cap) break;
      const sub = [];
      for (const l of lines) {
        if (total + head.length + l.text.length + 20 > cap) break;
        sub.push(l); total += l.text.length;
      }
      out.push({ title: s.title, lines: sub });
    }
    return out;
  }

  function sectionsToMarkdown(sections) {
    const lines = [];
    for (const s of sections) {
      lines.push('## ' + s.title);
      for (const l of s.lines) lines.push('- ' + l.text);
      lines.push('');
    }
    return lines.join('\n');
  }

  function exportMarkdown() {
    const md = sectionsToMarkdown(buildResumeStructure(20000));
    const blob = new Blob(['\ufeff' + md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (RS.state.projectName || '简历') + '.md';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function copyMarkdown() {
    const md = sectionsToMarkdown(buildResumeStructure(20000));
    try {
      await navigator.clipboard.writeText(md);
      RS.ui.toast('Markdown 已复制到剪贴板', 'ok');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      RS.ui.toast('Markdown 已复制到剪贴板', 'ok');
    }
  }

  RS.exporters = {
    exportPDF,
    exportPNG,
    exportWord,
    exportMarkdown,
    copyMarkdown,
    buildExportPage,
    buildResumeStructure,
    sectionsToMarkdown,
  };
})();
