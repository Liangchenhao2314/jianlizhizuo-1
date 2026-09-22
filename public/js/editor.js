/* ============================================================
 * editor.js —— 交互层（Word/WPS 式）：
 *   · 单击文本元素 = 选中 + 立即进入编辑（光标定位点击处，所见即所得）
 *   · 编辑中：字体/字号/颜色/对齐与元素完全一致，高度随内容自适应，
 *     背景遮罩实时更新（原版文字被即时盖掉，不重叠错乱）
 *   · 拖动 = 移动元素（编辑中按住拖动同样可移动）；8 手柄等比缩放
 *   · 浮动工具条：字体 / 字号 / B I U / 颜色 / 对齐 / 复制 / 删除 / 层级
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  const MM2PX = 96 / 25.4;
  const pagesEl = document.getElementById('pages');
  const floatBar = document.getElementById('floatBar');
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const FONTS = ['SimSun', 'SimHei', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Helvetica', 'Times New Roman', 'Calibri', 'Georgia', 'Courier New'];

  let dragging = null;
  let resizing = null;
  let editingId = null;        // 正在编辑的元素 id
  let editOriginalText = '';   // 进入编辑时的原文，用于判断是否真的改过
  let editMaskTimer = null;
  let anchor = null;           // 单击判定锚点 {mode,id,x,y,moved}

  /* ================= 选择 ================= */
  function select(id, additive) {
    if (additive) {
      const cur = RS.state.selected.slice();
      if (cur.includes(id)) cur.splice(cur.indexOf(id), 1);
      else cur.push(id);
      RS.setSelected(cur);
    } else {
      RS.setSelected([id]);
    }
  }
  function deselect() {
    if (RS.state.selected.length) RS.setSelected([]);
    hideFloatBar();
  }

  /* ================= 选区 UI（手柄 + 角标 + 快捷条） ================= */
  function updateSelectionUI() {
    document.querySelectorAll('.handle').forEach(h => h.remove());
    const ids = RS.state.selected;
    const nodes = [];
    for (const id of ids) {
      const n = pagesEl.querySelector('.el[data-id="' + id + '"]');
      if (n) nodes.push(n);
    }
    nodes.forEach(n => n.classList.add('selected'));
    if (!nodes.length) { hideFloatBar(); return; }
    const last = nodes[nodes.length - 1];
    // 角标：类型 + 字号（编辑中显示 ✎）
    const el = RS.getEl(last.dataset.id);
    if (el) {
      const b = document.createElement('div');
      b.className = 'el-badge';
      const label = el.type === 'text'
        ? ('文本 · ' + (el.fontSizePt || 10) + 'pt' + (el.dirty ? ' ✎' : ''))
        : el.type === 'image' ? '图片'
        : el.type === 'divider' ? '分割线'
        : el.type === 'shape' ? '形状'
        : '富文本';
      b.textContent = label;
      last.appendChild(b);
    }
    for (const h of HANDLES) {
      const d = document.createElement('div');
      d.className = 'handle ' + h;
      d.dataset.handle = h;
      last.appendChild(d);
    }
    buildFloatBar(nodes);
  }

  function buildFloatBar(nodes) {
    const el = RS.getEl(nodes[0].dataset.id);
    if (!el) { hideFloatBar(); return; }
    const isEditing = editingId === el.id;
    floatBar.innerHTML = '';
    const add = (label, title, fn, active) => {
      const b = document.createElement('button');
      b.className = 'fb-btn' + (active ? ' active' : '');
      b.title = title;
      b.innerHTML = label;
      b.onclick = (ev) => { ev.stopPropagation(); fn(); };
      floatBar.appendChild(b);
    };

    // 字体
    const fontSel = document.createElement('select');
    fontSel.className = 'fb-sel fb-font';
    fontSel.title = '字体';
    FONTS.forEach(f => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (el.fontFamily === f || (!el.fontFamily && f === 'SimSun')) o.selected = true;
      fontSel.appendChild(o);
    });
    fontSel.onchange = () => applyStyle({ fontFamily: fontSel.value });
    floatBar.appendChild(fontSel);

    // 字号
    const sizeIn = document.createElement('input');
    sizeIn.type = 'number'; sizeIn.className = 'fb-num';
    sizeIn.min = 4; sizeIn.max = 96;
    sizeIn.value = el.fontSizePt || 10;
    sizeIn.title = '字号（pt）';
    sizeIn.onchange = () => applyStyle({ fontSizePt: Math.max(4, Math.min(96, parseFloat(sizeIn.value) || 10)) });
    floatBar.appendChild(sizeIn);

    add('<b>B</b>', '加粗', () => {
      if (isEditing) { document.execCommand('bold'); return; }
      applyStyle({ bold: !el.bold });
    }, el.bold);
    add('<i>I</i>', '斜体', () => {
      if (isEditing) { document.execCommand('italic'); return; }
      applyStyle({ italic: !el.italic });
    }, el.italic);
    add('<u>U</u>', '下划线', () => {
      if (isEditing) { document.execCommand('underline'); return; }
      applyStyle({ underline: !el.underline });
    }, el.underline);

    const sep = document.createElement('div'); sep.className = 'fb-sep'; floatBar.appendChild(sep);

    const color = document.createElement('input');
    color.type = 'color';
    color.value = el.color || '#000000';
    color.title = '文字颜色';
    color.oninput = () => applyStyle({ color: color.value });
    floatBar.appendChild(color);

    const alignBtn = document.createElement('select');
    alignBtn.className = 'fb-sel';
    alignBtn.title = '对齐';
    ['left', 'center', 'right'].forEach(a => {
      const o = document.createElement('option');
      o.value = a; o.textContent = ({ left: '左对齐', center: '居中', right: '右对齐' })[a];
      if (el.align === a) o.selected = true;
      alignBtn.appendChild(o);
    });
    alignBtn.onchange = () => applyStyle({ align: alignBtn.value });
    floatBar.appendChild(alignBtn);

    const sep2 = document.createElement('div'); sep2.className = 'fb-sep'; floatBar.appendChild(sep2);
    add('复制', '复制元素 Ctrl+D', () => RS.duplicate(RS.state.selected));
    add('删除', '删除 Del', () => { if (editingId) exitEdit(true); RS.removeElements(RS.state.selected.slice()); });
    add('置顶', '置于最前', () => { const id = RS.state.selected[0]; if (id) RS.moveZ(id, 'top'); });
    add('置底', '置于最后', () => { const id = RS.state.selected[0]; if (id) RS.moveZ(id, 'bottom'); });

    floatBar.classList.remove('hidden');
    positionFloatBar(nodes);
  }

  function positionFloatBar(nodes) {
    const r = nodes[nodes.length - 1].getBoundingClientRect();
    const barH = floatBar.offsetHeight || 36;
    let top = r.top - barH - 8;
    if (top < 54) top = r.bottom + 8;
    let left = r.left + r.width / 2 - floatBar.offsetWidth / 2;
    left = Math.max(8, Math.min(window.innerWidth - floatBar.offsetWidth - 8, left));
    floatBar.style.left = left + 'px';
    floatBar.style.top = top + 'px';
  }
  function hideFloatBar() { floatBar.classList.add('hidden'); floatBar.innerHTML = ''; }

  /* 样式应用：编辑中只改实时节点样式（不重建 DOM，不打断输入）；
     非编辑时全量重绘 */
  function applyStyle(patch) {
    const editingEl = editingId ? RS.getEl(editingId) : null;
    for (const id of RS.state.selected) {
      const el = RS.getEl(id);
      if (!el) continue;
      Object.assign(el, patch);
      if (el.type === 'text' || patch.dirty) markDirty(el);
    }
    if (editingEl) {
      const node = pagesEl.querySelector('.el[data-id="' + editingEl.id + '"]');
      const span = node && node.querySelector('.t');
      if (span) {
        if (patch.fontFamily) span.style.fontFamily = RS.render.fontStack(patch.fontFamily);
        if (patch.fontSizePt) span.style.fontSize = RS.render.pt2px(patch.fontSizePt) + 'px';
        if (patch.color) span.style.color = patch.color;
        if (patch.align) span.style.textAlign = patch.align;
        if ('bold' in patch) span.style.fontWeight = patch.bold ? '700' : 'normal';
        if ('italic' in patch) span.style.fontStyle = patch.italic ? 'italic' : 'normal';
        if ('underline' in patch) span.style.textDecoration = patch.underline ? 'underline' : 'none';
        syncEditHeight(node, span, editingEl);
        if (editingEl.original) RS.render.redrawMasks(RS.getPage(editingEl.page));
      }
      RS.commit(true); // 不重绘，保持编辑
    } else {
      RS.render.renderAll();
      RS.commit();
    }
  }

  /* ================= 编辑标记（白底 + 转可见） ================= */
  function markDirty(el) {
    if (el.original) return;
    el.original = { x: el.x, y: el.y, w: el.w, h: el.h };
    el.dirty = true;
  }
  function intersects(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  function cascadeVisible(page) {
    const rects = [];
    for (const el of page.elements) if (el.original) rects.push(el.original);
    for (const g of page.ghosts || []) rects.push(g);
    for (const r of rects) {
      for (const el of page.elements) {
        if (el.type !== 'text' || el.dirty || el.forceVisible) continue;
        if (intersects(el, r)) el.forceVisible = true;
      }
    }
  }
  RS.editorCascade = cascadeVisible;

  /* ================= 拖动 ================= */
  function startDrag(e, el) {
    if (e.target.closest('[contenteditable="true"]')) return;
    const startX = e.clientX, startY = e.clientY;
    const starts = RS.state.selected.map(id => {
      const o = RS.getEl(id);
      return o ? { id, x: o.x, y: o.y } : null;
    }).filter(Boolean);
    let moved = false;

    function onMove(ev) {
      const dx = (ev.clientX - startX) / (MM2PX * RS.state.zoom);
      const dy = (ev.clientY - startY) / (MM2PX * RS.state.zoom);
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return;
      if (!moved) {
        moved = true;
        if (anchor) anchor.moved = true;
        for (const s of starts) {
          const o = RS.getEl(s.id);
          if (o && o.type === 'text') markDirty(o);
          if (o && o.type === 'image') markDirty(o);
        }
      }
      for (const s of starts) {
        const o = RS.getEl(s.id);
        if (!o) continue;
        o.x = Math.round((s.x + dx) * 2) / 2;
        o.y = Math.round((s.y + dy) * 2) / 2;
      }
      const n = pagesEl.querySelector('.el[data-id="' + starts[0].id + '"]');
      if (n) {
        const o = RS.getEl(starts[0].id);
        n.style.left = (o.x * MM2PX) + 'px';
        n.style.top = (o.y * MM2PX) + 'px';
      }
      positionFloatBar(pagesEl.querySelectorAll('.el.selected'));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) {
        for (const s of starts) {
          const o = RS.getEl(s.id);
          if (o) { cascadeVisible(RS.getPage(o.page)); RS.render.redrawMasks(RS.getPage(o.page)); }
        }
        RS.commit();
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* 编辑中按住拖动（>6px 判定）→ 退出编辑并移动元素 */
  function watchEditDrag(e, el) {
    const sx = e.clientX, sy = e.clientY;
    const checkMove = (ev) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) {
        window.removeEventListener('mousemove', checkMove);
        window.removeEventListener('mouseup', checkUp);
        ev.preventDefault();
        startEditDrag(ev, el);
      }
    };
    const checkUp = () => {
      window.removeEventListener('mousemove', checkMove);
      window.removeEventListener('mouseup', checkUp);
    };
    window.addEventListener('mousemove', checkMove);
    window.addEventListener('mouseup', checkUp);
  }
  function startEditDrag(e, el) {
    exitEdit(true);
    const node = pagesEl.querySelector('.el[data-id="' + el.id + '"]');
    if (node) select(el.id, false);
    startDrag(e, el);
  }

  /* ================= 缩放 ================= */
  function startResize(e, el, handle) {
    e.preventDefault(); e.stopPropagation();
    if (editingId) exitEdit(false);
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h, fs: el.fontSizePt || 10, src: el.src };
    markDirty(el);
    const page = RS.getPage(el.page);
    cascadeVisible(page);

    function onMove(ev) {
      const dx = (ev.clientX - startX) / (MM2PX * RS.state.zoom);
      const dy = (ev.clientY - startY) / (MM2PX * RS.state.zoom);
      let { x, y, w, h } = orig;
      if (handle.includes('e')) w = orig.w + dx;
      if (handle.includes('s')) h = orig.h + dy;
      if (handle.includes('w')) { w = orig.w - dx; x = orig.x + dx; }
      if (handle.includes('n')) { h = orig.h - dy; y = orig.y + dy; }
      w = Math.max(1.5, w); h = Math.max(1.5, h);
      if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
        const ratio = w / orig.w;
        el.fontSizePt = Math.max(4, Math.round(orig.fs * ratio * 10) / 10);
        h = w * (orig.h / orig.w);
      }
      if (el.type === 'image' && (handle.includes('e') || handle.includes('w') || handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se')) {
        h = w * (orig.h / orig.w);
      }
      el.x = Math.round(x * 2) / 2; el.y = Math.round(y * 2) / 2;
      el.w = Math.round(w * 2) / 2; el.h = Math.round(h * 2) / 2;
      const n = pagesEl.querySelector('.el[data-id="' + el.id + '"]');
      if (n) {
        n.style.left = (el.x * MM2PX) + 'px'; n.style.top = (el.y * MM2PX) + 'px';
        n.style.width = (el.w * MM2PX) + 'px'; n.style.height = (el.h * MM2PX) + 'px';
        const sp = n.querySelector('.t');
        if (sp && el.type === 'text') sp.style.fontSize = (el.fontSizePt * 96 / 72) + 'px';
      }
      updateSelectionUI();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      RS.render.redrawMasks(page);
      RS.commit();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ================= 所见即所得行内编辑 ================= */
  function sanitizeInline(root) {
    // 输入法/浏览器可能插入 font 或带 font-family 的 span，导致"字体走样"：
    // 剥离这些内联样式，字体统一由元素级 CSS 控制（只保留 b/i/u 语义）
    const walk = (n) => {
      const kids = Array.prototype.slice.call(n.childNodes || []);
      for (const c of kids) {
        if (c.nodeType === 1) {
          if (c.tagName === 'FONT' || c.tagName === 'SPAN') {
            const st = (c.getAttribute && (c.getAttribute('style') || '') || '').toLowerCase();
            if (c.tagName === 'FONT' || /font-family|font-size|color|background|letter-spacing|line-height/i.test(st)) {
              c.removeAttribute('style');
              c.removeAttribute('face');
              c.removeAttribute('size');
              c.removeAttribute('color');
            }
          }
          walk(c);
        }
      }
    };
    walk(root);
  }

  function syncEditHeight(node, span, el) {
    span.style.height = 'auto';
    const hpx = span.scrollHeight + 1;
    const hmm = hpx / MM2PX;
    el.h = Math.round(Math.max(2, hmm) * 2) / 2;
    node.style.height = (el.h * MM2PX) + 'px';
  }

  function throttledMask(page) {
    clearTimeout(editMaskTimer);
    editMaskTimer = setTimeout(() => {
      if (page) RS.render.redrawMasks(page);
    }, 220);
  }

  function onEditInput(ev) {
    const span = ev.target;
    const node = span.closest('.el');
    const el = node && RS.getEl(node.dataset.id);
    if (!el) return;
    sanitizeInline(span);
    syncEditHeight(node, span, el);
    throttledMask(RS.getPage(el.page));
  }

  function onEditPaste(ev) {
    ev.preventDefault();
    const text = ((ev.clipboardData || window.clipboardData) && (ev.clipboardData || window.clipboardData).getData('text/plain')) || '';
    document.execCommand('insertText', false, text);
  }

  function onEditBlur() {
    if (editingId) exitEdit(true);
  }

  /* 进入编辑：单击文本元素即触发（光标定位点击处） */
  function enterEdit(id, cx, cy) {
    const el = RS.getEl(id);
    const node = pagesEl.querySelector('.el[data-id="' + id + '"]');
    if (!el || !node) return;
    if (editingId === id) {
      const s = node.querySelector('.t');
      if (s) { s.focus(); }
      return;
    }
    if (el.type === 'html') {
      editingId = el.id;
      node.contentEditable = 'true';
      node.focus();
      document.execCommand('defaultParagraphSeparator', false, 'p');
      const done = () => {
        if (editingId !== el.id) return;
        node.contentEditable = 'false';
        el.html = node.innerHTML;
        markDirty(el);
        RS.render.redrawMasks(RS.getPage(el.page));
        RS.commit();
        editingId = null;
      };
      node.addEventListener('blur', done, { once: true });
      return;
    }
    const span = node.querySelector('.t') || node;
    if (!span) return;
    editingId = id;
    editOriginalText = (span.textContent || '');
    node.classList.add('editing');
    node.classList.remove('el-ghost');
    // 进入编辑即对原版文字盖白底，编辑文字全量可见（所见即所得，不打字看不见）
    if (!el.dirty) markDirty(el);
    RS.render.redrawMasks(RS.getPage(el.page));
    span.contentEditable = 'true';
    span.style.display = 'block';
    span.style.height = 'auto';
    node.style.height = 'auto';
    // 显式应用元素样式，保证输入文字与展示完全一致（所见即所得）
    span.style.fontFamily = RS.render.fontStack(el.fontFamily);
    span.style.fontSize = RS.render.pt2px(el.fontSizePt) + 'px';
    span.style.fontWeight = el.bold ? '700' : 'normal';
    span.style.fontStyle = el.italic ? 'italic' : 'normal';
    span.style.textDecoration = el.underline ? 'underline' : 'none';
    span.style.color = el.color || '#000';
    span.style.lineHeight = (el.lineHeight || 1.25);
    if (el.letterSpacingPt) span.style.letterSpacing = RS.render.pt2px(el.letterSpacingPt) + 'px';
    if (el.align) span.style.textAlign = el.align;

    span.focus();
    if (document.caretRangeFromPoint && cx != null && cy != null) {
      try {
        const r = document.caretRangeFromPoint(cx, cy);
        if (r && node.contains(r.startContainer)) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } else {
          const sel = window.getSelection();
          sel.selectAllChildren(span);
          sel.collapseToEnd();
        }
      } catch (e) {
        const sel = window.getSelection();
        sel.selectAllChildren(span);
        sel.collapseToEnd();
      }
    } else {
      const sel = window.getSelection();
      sel.selectAllChildren(span);
      sel.collapseToEnd();
    }
    document.execCommand('defaultParagraphSeparator', false, 'p');
    span.addEventListener('input', onEditInput);
    span.addEventListener('paste', onEditPaste);
    span.addEventListener('blur', onEditBlur, { once: true });
  }

  /* 退出编辑：提交文本、自适应高度、重建遮罩、保持选中可见 */
  function exitEdit(commit) {
    if (!editingId) return;
    const id = editingId;
    editingId = null;
    const el = RS.getEl(id);
    const node = pagesEl.querySelector('.el[data-id="' + id + '"]');
    if (!el || !node) { return; }
    const span = node.querySelector('.t');
    if (span) {
      const wasEditable = span.isContentEditable;
      if (wasEditable) {
        const newText = (span.textContent || '').replace(/\u00a0/g, ' ').replace(/\n+$/g, '');
        span.contentEditable = 'false';
        if (newText !== editOriginalText || el.dirty || el.forceVisible) {
          el.text = newText.trim() ? newText : ' ';
          markDirty(el);
          const hmm = (span.scrollHeight + 1) / MM2PX;
          el.h = Math.round(Math.max(2, hmm) * 2) / 2;
          span.innerHTML = RS.render.textToHTML(el.text);
          if (el.original) RS.render.redrawMasks(RS.getPage(el.page));
        } else {
          span.innerHTML = RS.render.textToHTML(el.text);
        }
      }
      span.style.display = '';
      span.style.height = '';
      span.style.color = '';
    }
    node.style.height = (el.h * MM2PX) + 'px';
    node.classList.remove('editing');
    if (commit) RS.commit();
  }

  /* ================= 键盘 ================= */
  function onKeyDown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (editingId) exitEdit(true);
      if (e.shiftKey) RS.redo(); else RS.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (editingId) exitEdit(true); RS.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (!inField && RS.state.selected.length) RS.duplicate(RS.state.selected.slice()); return; }
    if (e.key === 'Escape') {
      // 编辑中按 Esc：只退出编辑，保留选中（方便看清刚改到哪）；非编辑时取消选中
      if (editingId) { exitEdit(true); return; }
      deselect();
      return;
    }
    if (inField) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (RS.state.selected.length) { e.preventDefault(); if (editingId) exitEdit(true); RS.removeElements(RS.state.selected.slice()); }
      return;
    }
    if (RS.state.selected.length && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 1 : 0.5;
      const dx = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0;
      const dy = e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0;
      for (const id of RS.state.selected) {
        const el = RS.getEl(id);
        if (!el) continue;
        if (el.type === 'text') markDirty(el);
        el.x = Math.round((el.x + dx) * 2) / 2;
        el.y = Math.round((el.y + dy) * 2) / 2;
      }
      RS.render.renderAll();
      RS.commit();
    }
  }

  /* ================= 事件绑定 ================= */
  function init() {
    pagesEl.addEventListener('mousedown', (e) => {
      const handleNode = e.target.closest('.handle');
      const elNode = e.target.closest('.el');
      if (handleNode) {
        const el = RS.getEl(handleNode.closest('.el').dataset.id);
        if (el) startResize(e, el, handleNode.dataset.handle);
        return;
      }
      if (!elNode) {
        if (editingId) exitEdit(true);
        deselect();
        return;
      }
      const el = RS.getEl(elNode.dataset.id);
      if (!el) return;
      if (el.locked) { select(el.id, e.shiftKey); return; }
      if (editingId && editingId !== el.id) exitEdit(true);
      if (!RS.state.selected.includes(el.id)) select(el.id, e.shiftKey);
      else if (e.shiftKey) select(el.id, true);

      const inEdit = !!elNode.querySelector('[contenteditable="true"]');
      if (inEdit) {
        // 编辑中的元素内部：交给浏览器（定位光标/选词）；按住拖动 >6px 则移动元素
        anchor = { mode: 'edit', id: el.id, x: e.clientX, y: e.clientY, moved: false };
        watchEditDrag(e, el);
        return;
      }
      anchor = { mode: 'el', id: el.id, x: e.clientX, y: e.clientY, moved: false };
      startDrag(e, el);
    });

    window.addEventListener('mouseup', (e) => {
      if (!anchor) return;
      const a = anchor;
      anchor = null;
      if (a.moved) return;
      if (a.mode === 'el') {
        const el = RS.getEl(a.id);
        if (el && !el.locked && (el.type === 'text' || el.type === 'html')) {
          enterEdit(a.id, e.clientX, e.clientY);
        }
      }
    });

    pagesEl.addEventListener('dblclick', (e) => {
      const elNode = e.target.closest('.el');
      if (!elNode) return;
      const el = RS.getEl(elNode.dataset.id);
      if (!el || el.locked) return;
      if (el.type === 'text' || el.type === 'html') {
        if (editingId === el.id) return; // 单击已进入编辑
        select(el.id, false);
        enterEdit(el.id, e.clientX, e.clientY);
      } else if (el.type === 'image') {
        RS.ui.chooseImageFor(el.id);
      }
    });

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', () => {
      if (RS.state.selected.length) {
        const nodes = pagesEl.querySelectorAll('.el.selected');
        if (nodes.length) positionFloatBar(nodes);
      }
    });
    window.addEventListener('scroll', () => {
      if (RS.state.selected.length) {
        const nodes = pagesEl.querySelectorAll('.el.selected');
        if (nodes.length) positionFloatBar(nodes);
      }
    }, true);
  }

  RS.editor = {
    init,
    select,
    deselect,
    updateSelectionUI,
    positionFloatBar,
    hideFloatBar,
    markDirty,
    cascadeVisible,
    enterEdit,
    beginEdit: enterEdit,
    exitEdit,
  };
})();
