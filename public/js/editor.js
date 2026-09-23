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
  const ctxMenu = document.getElementById('ctxMenu');
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const FONTS = ['SimSun', 'SimHei', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Helvetica', 'Times New Roman', 'Calibri', 'Georgia', 'Courier New'];

  /* #000 → #000000（input[type=color] 需要 6 位十六进制） */
  function normalizeHex(c) {
    if (!c) return '#000000';
    const s = String(c).trim();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map(ch => ch + ch).join('');
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    return '#000000';
  }

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
      // 编辑中不渲染手柄（Word 式纯文字编辑观感，避免 8 个白点干扰）
      if (editingId) break;
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

    // 字体：子集字体（g_xxx）保持原版字形，显示真实名；检测到的原版字体也加入下拉
    const fontSel = document.createElement('select');
    fontSel.className = 'fb-sel fb-font';
    fontSel.title = '字体';
    const curFF = el.fontFamily || 'SimSun';
    const isSubset = /^g_[A-Za-z0-9_]+$/i.test(curFF);
    if (isSubset) {
      const o = document.createElement('option');
      o.value = curFF; o.textContent = el.fontReal || curFF; o.selected = true;
      fontSel.appendChild(o);
    }
    FONTS.forEach(f => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (curFF === f || (!el.fontFamily && f === 'SimSun')) o.selected = true;
      fontSel.appendChild(o);
    });
    (RS.importers.getDetectedFonts() || []).forEach(d => {
      if (d && d !== curFF && !FONTS.includes(d)) {
        const o = document.createElement('option');
        o.value = d; o.textContent = d;
        fontSel.appendChild(o);
      }
    });
    fontSel.onchange = () => applyStyle({ fontFamily: fontSel.value });
    floatBar.appendChild(fontSel);

    // 字号
    const sizeIn = document.createElement('input');
    sizeIn.type = 'number'; sizeIn.className = 'fb-num';
    sizeIn.min = 4; sizeIn.max = 96;
    sizeIn.value = String(Math.round((el.fontSizePt || 10) * 100) / 100);
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
    color.value = normalizeHex(el.color) || '#000000';
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
      if ('fontFamily' in patch) el.fontReal = null; // 用户主动换字体 → 取消原版字体兜底
      if (el.type === 'text' || patch.dirty) markDirty(el);
    }
    if (editingEl) {
      const node = pagesEl.querySelector('.el[data-id="' + editingEl.id + '"]');
      const span = node && node.querySelector('.t');
      if (span) {
        const sel = window.getSelection();
        const hasSel = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;
        // 字号：有选区 → 只改选中文字（Word 语义）；无选区 → 整块等比缩放（锁定块同步，字体/加粗不变）
        if (patch.fontSizePt) {
          const targetPt = Math.max(4, Math.min(96, patch.fontSizePt));
          if (hasSel && span.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            try { setSelSize(sel.getRangeAt(0), RS.render.pt2px(targetPt)); } catch (e) { span.style.fontSize = RS.render.pt2px(targetPt) + 'px'; }
          } else {
            const oldPt = editingEl.fontSizePt || 10;
            const ratio = oldPt > 0 ? targetPt / oldPt : 1;
            span.querySelectorAll('span[data-r]').forEach(s => {
              const cur = parseFloat(s.style.fontSize) || RS.render.pt2px(oldPt);
              s.style.fontSize = Math.max(4, Math.round(cur * ratio * 100) / 100) + 'px';
            });
            span.style.fontSize = RS.render.pt2px(targetPt) + 'px';
          }
        }
        // 字体：编辑中仅作用于光标/选区处的文字（Word 语义）；execCommand 失败则整块替换（含锁定块，用户主动换字体应生效）
        if (patch.fontFamily) {
          const fam = RS.render.fontStack(patch.fontFamily);
          if (hasSel && span.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            let ok = false;
            try { ok = document.execCommand('fontName', false, patch.fontFamily); } catch (e) {}
            if (!ok) span.style.fontFamily = fam;
          } else {
            span.style.fontFamily = fam;
            span.querySelectorAll('span[data-r]').forEach(s => { s.style.fontFamily = fam; });
          }
        }
        if (patch.color) span.style.color = patch.color;
        if (patch.align) span.style.textAlign = patch.align;
        if ('bold' in patch) span.style.fontWeight = patch.bold ? '700' : 'normal';
        if ('italic' in patch) span.style.fontStyle = patch.italic ? 'italic' : 'normal';
        if ('underline' in patch) span.style.textDecoration = patch.underline ? 'underline' : 'none';
        sanitizeInline(span);
        syncEditHeight(node, span, editingEl);
        if (editingEl.original) RS.render.redrawMasks(RS.getPage(editingEl.page));
      }
      RS.commit(undefined, true); // 第二参 true = 不重绘，保持编辑
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
    for (const el of page.elements) {
      if (el.original) {
        // 与遮罩一致：原始位置与当前位置的并集
        rects.push({
          x: Math.min(el.original.x, el.x),
          y: Math.min(el.original.y, el.y),
          w: Math.max(el.original.x + el.original.w, el.x + el.w) - Math.min(el.original.x, el.x),
          h: Math.max(el.original.y + el.original.h, el.y + el.h) - Math.min(el.original.y, el.y),
        });
      }
    }
    for (const g of page.ghosts || []) rects.push(g);
    for (const r of rects) {
      for (const el of page.elements) {
        if (el.type !== 'text' || el.dirty || el.forceVisible) continue;
        if (intersects(el, r)) el.forceVisible = true;
      }
    }
  }
  RS.editorCascade = cascadeVisible;

  /* ================= 行管理：吸附对齐 + 自动避让（一行归一行） ================= */
  const ROW_GAP = 1.5; // mm，行间最小间距

  // 拖动时把文本行 y 吸附到邻近行的对齐线（同一水平线不打架）
  function snapToLines(el) {
    const page = RS.getPage(el.page);
    if (!page) return;
    const candidates = page.elements.filter(e => e.type === 'text' && e.id !== el.id && !e.locked);
    let best = null;
    for (const c of candidates) {
      const d = Math.abs(c.y - el.y);
      if (d < 1.1 && (!best || d < best.d)) best = { y: c.y, d };
    }
    if (best) el.y = best.y;
  }

  // 放下后自动避让：页面文本元素两两重叠时，把下方元素往下推，直到互不重叠
  function resolveOverlaps(pageId) {
    const page = RS.getPage(pageId);
    if (!page) return false;
    const sorted = page.elements.filter(e => e.type === 'text' && (e.text || '').trim() && !e.locked)
      .sort((a, b) => a.y - b.y);
    let changed = false;
    for (let guard = 0; guard < 50; guard++) {
      let hit = false;
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
            const newY = a.y + a.h + ROW_GAP;
            if (b.y < newY) { b.y = Math.round(newY * 2) / 2; changed = true; hit = true; }
          }
        }
      }
      if (!hit) break;
      sorted.sort((a, b) => a.y - b.y);
    }
    return changed;
  }

  // 一键整理：页面上文本行按顺序垂直排布，行距统一，绝不重叠
  function tidyLines() {
    if (!RS.state.pages.length) { RS.ui.toast('请先导入或新建简历', 'warn'); return; }
    let moved = 0;
    for (const p of RS.state.pages) {
      const els = p.elements.filter(e => e.type === 'text' && !e.locked)
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
      let y = null;
      for (const e of els) {
        if (y !== null) { e.y = Math.round(y * 2) / 2; moved++; }
        y = e.y + e.h + ROW_GAP;
      }
    }
    RS.render.renderAll();
    RS.commit();
    RS.ui.toast('已按行整理排版：' + moved + ' 处位置对齐（可 Ctrl+Z 撤销）', 'ok');
    RS.ui.checkFit && RS.ui.checkFit();
  }

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
        if (o.type === 'text') snapToLines(o); // 拖动中吸附到行对齐线
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
        // 放下后：已移动的元素盖白底，并自动避让重叠的相邻行
        const movedIds = new Set();
        for (const s of starts) {
          const o = RS.getEl(s.id);
          if (o) { cascadeVisible(RS.getPage(o.page)); RS.render.redrawMasks(RS.getPage(o.page)); movedIds.add(o.id); }
        }
        for (const s of starts) {
          const o = RS.getEl(s.id);
          if (o && o.type === 'text') {
            const changed = resolveOverlaps(o.page);
            if (changed) RS.render.redrawMasks(RS.getPage(o.page));
          }
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
      if (el.type === 'text') resolveOverlaps(el.page);
      RS.commit();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ================= 所见即所得行内编辑 ================= */
  /* 输入过程净化：FONT 解包；data-r 锁定样式永不动；只清理明显的粘贴垃圾
     （background/letter-spacing/line-height），保留 font-* 与 color——
     这些可能是用户主动设置的（浮条换字体/颜色），剥掉会造成"改了没反应"。 */
  function sanitizeInline(root) {
    const walk = (n) => {
      const kids = Array.prototype.slice.call(n.childNodes || []);
      for (const c of kids) {
        if (c.nodeType === 1) {
          if (c.tagName === 'FONT') {
            // FONT 标签解包（保留文字）
            const p = document.createElement('span');
            while (c.firstChild) p.appendChild(c.firstChild);
            c.parentNode.replaceChild(p, c);
            walk(p);
            continue;
          }
          if (c.tagName === 'SPAN') {
            // 解析型锁定样式（data-r="1"，来自 PDF/Word 原版的字体与加粗）：
            // 原样保留，任何输入/粘贴/编辑都不得剥离，保证"改文字字体永不变"
            if (c.getAttribute && c.getAttribute('data-r')) { walk(c); continue; }
            const st = (c.getAttribute && (c.getAttribute('style') || '') || '');
            if (/background|letter-spacing|line-height/i.test(st)) {
              const keep = st.split(';').filter(p => !/background|letter-spacing|line-height/i.test(p));
              const nst = keep.join(';').trim();
              if (nst) c.setAttribute('style', nst); else c.removeAttribute('style');
            }
          }
          walk(c);
        }
      }
    };
    walk(root);
  }

  /* 退出编辑时把内容净化为可持久化的富文本（只允许 b/i/u/a/span[font-size]/br/div） */
  function cleanRich(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const allowed = { B: 1, I: 1, U: 1, A: 1, SPAN: 1, BR: 1, DIV: 1 };
    const walk = (n) => {
      for (const c of Array.from(n.children || [])) {
        if (!allowed[c.tagName]) {
          while (c.firstChild) n.insertBefore(c.firstChild, c);
          n.removeChild(c);
          continue;
        }
        if (c.tagName === 'SPAN') {
          // data-r 锁定样式（原版字体/加粗）：原样持久化，编辑永不剥离
          if (c.getAttribute && c.getAttribute('data-r')) { walk(c); continue; }
          const keep = (c.getAttribute('style') || '').split(';').filter(p => !/background|letter-spacing|line-height/i.test(p));
          const nst = keep.join(';').trim();
          if (nst) c.setAttribute('style', nst); else c.removeAttribute('style');
        } else if (c.tagName === 'A') {
          const href = c.getAttribute('href');
          if (!href || !/^https?:\/\//i.test(href)) {
            while (c.firstChild) n.insertBefore(c.firstChild, c);
            n.removeChild(c);
            continue;
          }
          c.setAttribute('target', '_blank');
          c.setAttribute('rel', 'noopener');
          ['style', 'class'].forEach(a => c.removeAttribute(a));
        } else if (c.tagName !== 'BR' && c.tagName !== 'DIV' && c.tagName !== 'B' && c.tagName !== 'I' && c.tagName !== 'U') {
          ['style', 'class'].forEach(a => c.removeAttribute(a));
        }
        walk(c);
      }
    };
    walk(tpl);
    return tpl.innerHTML;
  }
  function hasFormat(html) {
    return /<(?:b|i|u|a)\b/i.test(html) || /<span[^>]*style=/i.test(html);
  }

  /* 选区字号设为指定值（Word 式局部字号） */
  function setSelSize(r, px) {
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try {
      r.surroundContents(span);
    } catch (e) {
      const frag = r.extractContents();
      span.appendChild(frag);
      r.insertNode(span);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.addRange(nr);
    return span;
  }

  /* 选区字号 ±0.5pt（Word 式局部字号） */
  function bumpSelRange(r, delta) {
    const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const base = parseFloat(getComputedStyle(host).fontSize) || 13;
    const size = Math.max(6, Math.min(48, base + delta));
    setSelSize(r, size);
  }

  /* 清除格式（选区）：只清用户格式，data-r 锁定样式原样保留 */
  function clearSelFormat() {
    const node = document.querySelector('.el.editing');
    const span = node && node.querySelector('.t');
    if (!span) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!span.contains(r.commonAncestorContainer)) return;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_ELEMENT);
    const targets = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      try { if (!r.intersectsNode(n)) continue; } catch (e) { continue; }
      const tag = n.nodeName;
      if (tag === 'SPAN' && !n.getAttribute('data-r')) { n.removeAttribute('style'); targets.push(n); }
      else if (tag === 'B' || tag === 'I' || tag === 'U') { targets.push(n); }
    }
    for (const t of targets) {
      if (t.nodeName === 'B' || t.nodeName === 'I' || t.nodeName === 'U') {
        while (t.firstChild) t.parentNode.insertBefore(t.firstChild, t);
        t.parentNode.removeChild(t);
      }
    }
    sanitizeInline(span);
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
    // 进入编辑后重建选区 UI：编辑中不显示缩放手柄（Word 式纯文字观感）
    updateSelectionUI();
    // 有富文本（局部格式）时先渲染，再进入编辑，保证既有格式可见可继续编辑
    span.innerHTML = el.rich || RS.render.textToHTML(el.text);
    editOriginalText = span.innerText || span.textContent || '';
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
    span.style.fontFamily = RS.render.fontStack(el.fontFamily, el.fontReal);
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
    hideSelBar();
    const id = editingId;
    editingId = null;
    const el = RS.getEl(id);
    const node = pagesEl.querySelector('.el[data-id="' + id + '"]');
    if (!el || !node) { return; }
    const span = node.querySelector('.t');
    if (span) {
      const wasEditable = span.isContentEditable;
      if (wasEditable) {
        const newText = (span.innerText || span.textContent || '').replace(/\u00a0/g, ' ').replace(/\n+$/g, '');
        span.contentEditable = 'false';
        const rich = cleanRich(span.innerHTML);
        const fmt = hasFormat(rich);
        if (newText !== editOriginalText || el.dirty || el.forceVisible || fmt) {
          el.text = newText.trim() ? newText : ' ';
          markDirty(el);
          if (fmt) el.rich = rich; else delete el.rich;
          const hmm = (span.scrollHeight + 1) / MM2PX;
          el.h = Math.round(Math.max(2, hmm) * 2) / 2;
          span.innerHTML = fmt ? rich : RS.render.textToHTML(el.text);
          if (el.original) RS.render.redrawMasks(RS.getPage(el.page));
        } else {
          span.innerHTML = RS.render.textToHTML(el.text);
          delete el.rich;
        }
      }
      span.style.display = '';
      span.style.height = '';
      span.style.color = '';
    }
    node.style.height = (el.h * MM2PX) + 'px';
    node.classList.remove('editing');
    if (commit) {
      // 退出编辑：高度变化后自动把下方重叠的行推下去（一行归一行）
      let changed = false;
      if (el.type === 'text') changed = resolveOverlaps(el.page);
      if (changed) RS.render.renderAll();
      updateSelectionUI(); // 重建选区 UI：编辑态已结束，恢复缩放手柄
      RS.commit();
    }
  }

  /* ================= 选区迷你格式条（Word 式） ================= */
  const selBar = document.getElementById('selBar');
  let selBarTimer = null;

  function selectionInEditing() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return false;
    const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    return !!(host && host.closest && host.closest('.el.editing'));
  }
  function showSelBar() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { hideSelBar(); return; }
    const r = sel.getRangeAt(0);
    const rect = r.getBoundingClientRect();
    if (!rect.width && !rect.height) { hideSelBar(); return; }
    selBar.classList.remove('hidden');
    const w = selBar.offsetWidth || 230;
    let left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    let top = rect.top - selBar.offsetHeight - 8;
    if (top < 56) top = rect.bottom + 8;
    selBar.style.left = left + 'px';
    selBar.style.top = top + 'px';
  }
  function hideSelBar() { if (selBar) selBar.classList.add('hidden'); }

  function selCmd(name) {
    const node = document.querySelector('.el.editing');
    const span = node && node.querySelector('.t');
    if (!span) return;
    const el = node && RS.getEl(node.dataset.id);
    if (!el) return;
    span.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!span.contains(r.commonAncestorContainer)) return;
    try {
      if (name === 'link') {
        const url = prompt('输入链接地址：', 'https://');
        if (!url || !/^https?:\/\//i.test(url.trim())) { RS.ui.toast('请输入以 https:// 开头的完整链接', 'err'); return; }
        document.execCommand('createLink', false, url.trim());
      } else if (name === 'sizeUp') {
        bumpSelRange(r, 1.3333);
      } else if (name === 'sizeDown') {
        bumpSelRange(r, -1.3333);
      } else if (name === 'clear') {
        clearSelFormat(); // 保护 data-r 锁定样式，只清用户格式
      } else {
        document.execCommand(name === 'bold' ? 'bold' : name === 'italic' ? 'italic' : 'underline');
      }
      sanitizeInline(span);
      syncEditHeight(node, span, el);
      throttledMask(RS.getPage(el.page));
      RS.commit(undefined, true); // 第二参 true = 不重绘，保持编辑态
    } catch (e) { console.warn('selCmd', e); }
  }

  function bindSelBar() {
    if (!selBar) return;
    selBar.querySelectorAll('button[data-cmd]').forEach(b => {
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', () => selCmd(b.dataset.cmd));
    });
    document.addEventListener('selectionchange', () => {
      clearTimeout(selBarTimer);
      selBarTimer = setTimeout(() => {
        if (selectionInEditing()) {
          showSelBar();
          syncFloatSizeWithCaret(); // 浮条字号实时显示光标处字号（Word 语义）
        } else hideSelBar();
      }, 50);
    });
  }

  /* 浮条字号框同步为光标所在文字的字号（pt） */
  function syncFloatSizeWithCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;
    const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const el = host && host.closest ? host.closest('.el') : null;
    const num = document.querySelector('#floatBar .fb-num');
    if (!el || !num) return;
    const fs = parseFloat(getComputedStyle(host).fontSize);
    if (fs > 0) num.value = String(Math.round(fs * 72 / 96 * 100) / 100);
  }

  /* ================= 右键菜单（Word 式） ================= */
  function hideCtx() { if (ctxMenu) { ctxMenu.classList.add('hidden'); ctxMenu.innerHTML = ''; } }

  function ctxItem(label, fn, danger) {
    const b = document.createElement('button');
    b.textContent = label;
    if (danger) b.classList.add('danger');
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', () => { hideCtx(); fn(); });
    return b;
  }

  function showCtx(x, y) {
    if (!ctxMenu) return;
    ctxMenu.innerHTML = '';
    const ids = RS.state.selected.slice();
    const el = RS.getEl(ids[ids.length - 1]);
    if (!el) return;
    const sep = () => { const d = document.createElement('div'); d.className = 'ctx-sep'; ctxMenu.appendChild(d); };

    ctxMenu.appendChild(ctxItem('复制', () => { if (ids.length) RS.duplicate(ids); }));
    ctxMenu.appendChild(ctxItem('删除', () => { RS.removeElements(ids.slice()); }, true));
    ctxMenu.appendChild(ctxItem('置顶', () => { const id = ids[0]; if (id) RS.moveZ(id, 'top'); }));
    ctxMenu.appendChild(ctxItem('置底', () => { const id = ids[0]; if (id) RS.moveZ(id, 'bottom'); }));

    if (el.type === 'text') {
      sep();
      ctxMenu.appendChild(ctxItem('加粗', () => applyStyle({ bold: !el.bold })));
      ctxMenu.appendChild(ctxItem('斜体', () => applyStyle({ italic: !el.italic })));
      ctxMenu.appendChild(ctxItem('下划线', () => applyStyle({ underline: !el.underline })));
      sep();
      ctxMenu.appendChild(ctxItem('字号 +1pt', () => applyStyle({ fontSizePt: Math.max(4, Math.min(96, (el.fontSizePt || 10) + 1)) })));
      ctxMenu.appendChild(ctxItem('字号 -1pt', () => applyStyle({ fontSizePt: Math.max(4, Math.min(96, (el.fontSizePt || 10) - 1)) })));
      sep();
      ctxMenu.appendChild(ctxItem('左对齐', () => applyStyle({ align: 'left' })));
      ctxMenu.appendChild(ctxItem('居中', () => applyStyle({ align: 'center' })));
      ctxMenu.appendChild(ctxItem('右对齐', () => applyStyle({ align: 'right' })));
    } else if (el.type === 'image') {
      sep();
      ctxMenu.appendChild(ctxItem('更换图片', () => RS.ui.chooseImageFor(el.id)));
    }

    ctxMenu.classList.remove('hidden');
    const w = ctxMenu.offsetWidth || 150, h = ctxMenu.offsetHeight || 200;
    ctxMenu.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, x)) + 'px';
    ctxMenu.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, y)) + 'px';
  }

  /* ================= 键盘 ================= */
  function onKeyDown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (editingId) {
        // 编辑中：Word 语义 —— 先撤销打字（不退出编辑），保持光标在位
        document.execCommand(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (e.shiftKey) RS.redo(); else RS.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (editingId) { document.execCommand('redo'); return; }
      RS.redo(); return;
    }
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
    bindSelBar();
    // 右键菜单（Word 式）：元素上右键显示；空白处隐藏（不拦截浏览器默认菜单）
    pagesEl.addEventListener('contextmenu', (e) => {
      const elNode = e.target.closest('.el');
      if (!elNode) { hideCtx(); return; }
      const el = RS.getEl(elNode.dataset.id);
      if (!el || el.locked) { hideCtx(); return; }
      e.preventDefault();
      if (!RS.state.selected.includes(el.id)) select(el.id, false);
      if (editingId) exitEdit(true);
      showCtx(e.clientX, e.clientY);
    });
    document.addEventListener('mousedown', () => hideCtx());
    window.addEventListener('scroll', hideCtx, true);
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
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (el.locked) { select(el.id, additive); return; }
      if (editingId && editingId !== el.id) exitEdit(true);
      if (!RS.state.selected.includes(el.id)) select(el.id, additive);
      else if (additive) select(el.id, true);

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
    snapToLines,
    resolveOverlaps,
    tidyLines,
  };
})();
