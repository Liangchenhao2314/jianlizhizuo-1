/* ============================================================
 * render.js —— 页面渲染引擎
 * 页面结构：.page-wrap > .page > canvas.bg(可见位图) + .els(元素层)
 * 位图层包含"原始位图"与"可见位图"两张：任何白底覆盖都先重绘再叠加，
 * 保证撤销/重做后遮罩可恢复。
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  const MM2PX = 96 / 25.4;

  let pageCanvases = {};   // pageId -> {bgOrig, bgVis, viewport, pdfPage}
  const pagesEl = document.getElementById('pages');

  function clearCanvases() { pageCanvases = {}; }
  function setCanvas(pageId, obj) { pageCanvases[pageId] = obj; }
  function getCanvas(pageId) { return pageCanvases[pageId] || null; }

  function scale() { return MM2PX; } // 页面元素以 96dpi 基准定位，缩放用 CSS transform

  /* ================= 页面渲染 ================= */
  function renderAll() {
    if (!pagesEl) return;
    if (RS.ensureIds) RS.ensureIds();
    // 有页面时隐藏空状态引导
    const empty = document.getElementById('emptyState');
    if (empty) empty.classList.toggle('hidden', RS.state.pages.length > 0);
    pagesEl.innerHTML = '';
    for (const page of RS.state.pages) {
      pagesEl.appendChild(renderPage(page));
    }
    // 遮罩重绘
    for (const page of RS.state.pages) redrawMasks(page);
    if (RS.editor) RS.editor.updateSelectionUI();
  }

  function renderPage(page) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    const w = page.w || RS.state.pageW;
    const h = page.h || RS.state.pageH;
    // 外层容器按"缩放后"尺寸参与布局居中；内层 page 做 transform 缩放
    wrap.style.width = (w * MM2PX * RS.state.zoom) + 'px';
    wrap.style.height = (h * MM2PX * RS.state.zoom) + 'px';
    wrap.dataset.pageId = page.id;

    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.style.width = (w * MM2PX) + 'px';
    pageDiv.style.height = (h * MM2PX) + 'px';
    pageDiv.style.transform = 'scale(' + RS.state.zoom + ')';
    pageDiv.style.transformOrigin = 'top left';
    pageDiv.dataset.pageId = page.id;

    // 位图背景（仅 PDF 导入有）
    if (!page.noCanvas) {
      const cv = getCanvas(page.id);
      const canvas = document.createElement('canvas');
      canvas.className = 'bg';
      const src = cv && (cv.bgVis || cv.bgOrig);
      canvas.width = src ? src.width : 1;
      canvas.height = src ? src.height : 1;
      canvas.style.width = (w * MM2PX) + 'px';
      canvas.style.height = (h * MM2PX) + 'px';
      if (src) canvas.getContext('2d').drawImage(src, 0, 0);
      pageDiv.appendChild(canvas);
    }

    const elsLayer = document.createElement('div');
    elsLayer.className = 'els';
    const sorted = RS.byZ(page.elements);
    for (const el of sorted) {
      elsLayer.appendChild(makeElNode(el));
    }
    pageDiv.appendChild(elsLayer);
    wrap.appendChild(pageDiv);
    return wrap;
  }

  /* ---- 元素节点 ---- */
  function makeElNode(el) {
    const div = document.createElement('div');
    div.className = 'el el-' + el.type;
    div.dataset.id = el.id;
    if (el.locked) div.classList.add('locked');
    const px = v => v * MM2PX;
    div.style.left = px(el.x) + 'px';
    div.style.top = px(el.y) + 'px';
    div.style.width = px(el.w) + 'px';
    div.style.height = px(el.h) + 'px';
    div.style.zIndex = el.z || 0;
    if (el.rotation) div.style.transform = 'rotate(' + el.rotation + 'deg)';
    if (typeof el.opacity === 'number' && el.opacity < 1) div.style.opacity = el.opacity;

    if (el.type === 'text') {
      const visible = el.dirty || el.forceVisible || (el.page && RS.getPage(el.page) && RS.getPage(el.page).noCanvas);
      if (!visible) div.classList.add('el-ghost');
      const span = document.createElement('span');
      span.className = 't';
      span.innerHTML = el.rich || textToHTML(el.text);
      span.style.fontFamily = fontStack(el.fontFamily);
      span.style.fontSize = pt2px(el.fontSizePt) + 'px';
      if (el.bold) span.style.fontWeight = '700';
      if (el.italic) span.style.fontStyle = 'italic';
      if (el.underline) span.style.textDecoration = 'underline';
      span.style.color = visible ? (el.color || '#000') : 'transparent';
      span.style.textAlign = el.align || 'left';
      span.style.lineHeight = (el.lineHeight || 1.25);
      if (el.letterSpacingPt) span.style.letterSpacing = pt2px(el.letterSpacingPt) + 'px';
      if (el.bgColor) { span.style.background = el.bgColor; span.style.display = 'block'; span.style.padding = '1px 3px'; }
      div.appendChild(span);
    } else if (el.type === 'image') {
      const img = document.createElement('img');
      img.src = el.src;
      img.draggable = false;
      if (el.fit === 'contain') img.style.objectFit = 'contain';
      div.appendChild(img);
    } else if (el.type === 'divider') {
      const d = document.createElement('div');
      d.style.cssText = 'width:100%;height:' + px(el.thickness || 1) + 'px;background:' + (el.color || '#000') + ';border-radius:1px;';
      if (el.dash) d.style.borderTop = (el.thickness || 1) + 'px dashed ' + (el.color || '#000');
      if (el.dash) d.style.background = 'none';
      div.appendChild(d);
    } else if (el.type === 'shape') {
      div.style.background = el.fill || 'transparent';
      div.style.border = (el.borderWidth || 0) + 'px solid ' + (el.borderColor || '#000');
      if (el.shapeType === 'ellipse') div.style.borderRadius = '50%';
      else if (el.radius) div.style.borderRadius = px(el.radius) + 'px';
    } else if (el.type === 'html') {
      div.classList.add('el-html');
      div.innerHTML = el.html || '';
      if (el.dirty || el.forceVisible || (RS.getPage(el.page) || {}).noCanvas) div.style.color = el.color || '#000';
    }
    return div;
  }

  function textToHTML(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
  function fontStack(f) {
    const fam = f || 'SimSun';
    return '"' + fam + '", "Microsoft YaHei", "PingFang SC", sans-serif, serif';
  }
  function pt2px(pt) { return pt * 96 / 72; }

  /* ================= 白底遮罩 ================= */
  function whiteoutRects(page) {
    const rects = [];
    for (const el of page.elements) {
      if (el.original) {
        // 修改后元素位置/尺寸可能变化（文字变长/变高/被拖动），
        // 遮罩要覆盖"原始位置"与"当前位置"的并集，否则新文字叠在原版文字上成双影
        const x0 = Math.min(el.original.x, el.x);
        const y0 = Math.min(el.original.y, el.y);
        const x1 = Math.max(el.original.x + el.original.w, el.x + el.w);
        const y1 = Math.max(el.original.y + el.original.h, el.y + el.h);
        rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    for (const g of page.ghosts || []) rects.push(g);
    return rects;
  }

  function redrawMasks(page) {
    // 被遮挡区域的文本转为可见（级联）
    if (RS.editorCascade) RS.editorCascade(page);
    const cv = getCanvas(page.id);
    if (!cv || !cv.bgOrig) return;
    if (!cv.bgVis) {
      cv.bgVis = document.createElement('canvas');
      cv.bgVis.width = cv.bgOrig.width;
      cv.bgVis.height = cv.bgOrig.height;
    }
    const ctx = cv.bgVis.getContext('2d');
    ctx.clearRect(0, 0, cv.bgVis.width, cv.bgVis.height);
    ctx.drawImage(cv.bgOrig, 0, 0);
    const s = MM2PX * (cv.dpr || 1); // 位图按 dpr 放大，遮罩坐标同步
    for (const r of whiteoutRects(page)) {
      const cx = Math.round((r.x + r.w / 2) * s);
      const cy = Math.round((r.y + r.h / 2) * s);
      const color = sampleColor(cv.bgOrig, cx, cy) || '#ffffff';
      // 稍微外扩 0.4mm，避免边缘残留
      const x0 = Math.max(0, (r.x - 0.4) * s), y0 = Math.max(0, (r.y - 0.4) * s);
      const x1 = Math.min(cv.bgVis.width, (r.x + r.w + 0.4) * s), y1 = Math.min(cv.bgVis.height, (r.y + r.h + 0.4) * s);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // 同步到 DOM 中的可见 canvas
    const domCanvas = pagesEl.querySelector('.page[data-page-id="' + page.id + '"] canvas.bg');
    if (domCanvas) {
      const dctx = domCanvas.getContext('2d');
      dctx.clearRect(0, 0, domCanvas.width, domCanvas.height);
      dctx.drawImage(cv.bgVis, 0, 0);
    }
  }

  function sampleColor(canvas, cx, cy) {
    try {
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, cx)), Math.max(0, Math.min(canvas.height - 1, cy)), 1, 1).data;
      return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
    } catch (e) { return null; }
  }

  /* ================= 缩放 ================= */
  function setZoom(z, center) {
    z = Math.max(0.2, Math.min(4, z));
    RS.state.zoom = z;
    const wraps = pagesEl.querySelectorAll('.page-wrap');
    for (const w of wraps) {
      const page = w.querySelector('.page');
      if (!page) continue;
      page.style.transform = 'scale(' + z + ')';
      const pw = parseFloat(page.style.width) || 0;
      const ph = parseFloat(page.style.height) || 0;
      w.style.width = (pw * z) + 'px';
      w.style.height = (ph * z) + 'px';
    }
    if (RS.ui) RS.ui.updateZoomLabel();
  }
  function fitWidth() {
    const area = document.getElementById('canvasArea');
    if (!area || !RS.state.pages.length) return;
    const avail = area.clientWidth - 52;
    const w = (RS.state.pages[0].w || RS.state.pageW) * MM2PX;
    const z = Math.max(0.2, Math.min(2.5, avail / w));
    setZoom(z);
  }

  RS.render = {
    MM2PX,
    renderAll,
    renderPage,
    makeElNode,
    redrawMasks,
    whiteoutRects,
    clearCanvases,
    setCanvas,
    getCanvas,
    setZoom,
    fitWidth,
    scale,
    textToHTML,
    fontStack,
    pt2px,
  };
})();
