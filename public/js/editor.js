/* ============================================================
 * editor.js —— 交互层：选择 / 拖动 / 缩放 / 行内编辑 / 快捷工具条 / 键盘
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  const MM2PX = 96 / 25.4;
  const pagesEl = document.getElementById('pages');
  const floatBar = document.getElementById('floatBar');
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  let dragging = null;
  let resizing = null;
  let editingId = null;

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

  /* ================= 选区 UI（手柄 + 快捷条） ================= */
  function updateSelectionUI() {
    // 清旧手柄
    document.querySelectorAll('.handle').forEach(h => h.remove());
    const ids = RS.state.selected;
    const nodes = [];
    for (const id of ids) {
      const n = pagesEl.querySelector('.el[data-id="' + id + '"]');
      if (n) nodes.push(n);
    }
    nodes.forEach(n => n.classList.add('selected'));
    if (!nodes.length) { hideFloatBar(); return; }
    // 手柄挂在最后一个选中元素上
    const last = nodes[nodes.length - 1];
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
    floatBar.innerHTML = '';
    const add = (label, title, fn, active) => {
      const b = document.createElement('button');
      b.className = 'fb-btn' + (active ? ' active' : '');
      b.title = title;
      b.innerHTML = label;
      b.onclick = (ev) => { ev.stopPropagation(); fn(); };
      floatBar.appendChild(b);
    };
    add('<b>B</b>', '加粗', () => applyStyle({ bold: !el.bold }));
    add('<i>I</i>', '斜体', () => applyStyle({ italic: !el.italic }));
    add('<u>U</u>', '下划线', () => applyStyle({ underline: !el.underline }));
    add('A−', '减小字号', () => applyStyle({ fontSizePt: Math.max(6, (el.fontSizePt || 10) - 1) }));
    add('A＋', '增大字号', () => applyStyle({ fontSizePt: Math.min(72, (el.fontSizePt || 10) + 1) }));

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
    add('删除', '删除 Del', () => RS.removeElements(RS.state.selected.slice()));
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

  function applyStyle(patch) {
    for (const id of RS.state.selected) {
      const el = RS.getEl(id);
      if (!el) continue;
      Object.assign(el, patch);
      if (el.type === 'text' || patch.dirty) markDirty(el);
    }
    RS.render.renderAll();
    RS.commit();
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

  /* ================= 缩放 ================= */
  function startResize(e, el, handle) {
    e.preventDefault(); e.stopPropagation();
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
        // 角点等比缩放（文字同步缩放字号）
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

  /* ================= 行内编辑 ================= */
  function beginEdit(node, el) {
    if (el.type === 'html') {
      editingId = el.id;
      node.contentEditable = 'true';
      node.focus();
      document.execCommand('defaultParagraphSeparator', false, 'p');
      const done = () => {
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
    editingId = el.id;
    span.contentEditable = 'true';
    span.style.color = el.color || '#000';
    span.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(span);
    const done = () => {
      span.contentEditable = 'false';
      el.text = (span.textContent || '').replace(/\u00a0/g, ' ');
      if (!el.text.trim()) el.text = ' ';
      span.innerHTML = RS.render.textToHTML(el.text);
      if (!(el.dirty || el.forceVisible)) markDirty(el);
      else markDirty(el);
      RS.render.redrawMasks(RS.getPage(el.page));
      RS.commit();
      editingId = null;
    };
    span.addEventListener('blur', done, { once: true });
  }

  /* ================= 键盘 ================= */
  function onKeyDown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) RS.redo(); else RS.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); RS.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (!inField && RS.state.selected.length) RS.duplicate(RS.state.selected.slice()); return; }
    if (inField) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (RS.state.selected.length) { e.preventDefault(); RS.removeElements(RS.state.selected.slice()); }
      return;
    }
    if (e.key === 'Escape') { deselect(); return; }
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
        // 点空白：取消选择
        if (!e.target.closest('[contenteditable="true"]')) deselect();
        return;
      }
      const el = RS.getEl(elNode.dataset.id);
      if (!el) return;
      if (el.locked) { select(el.id, e.shiftKey); return; }
      if (!RS.state.selected.includes(el.id)) select(el.id, e.shiftKey);
      else if (e.shiftKey) select(el.id, true);
      startDrag(e, el);
    });

    pagesEl.addEventListener('dblclick', (e) => {
      const elNode = e.target.closest('.el');
      if (!elNode) return;
      const el = RS.getEl(elNode.dataset.id);
      if (!el || el.locked) return;
      if (el.type === 'text' || el.type === 'html') {
        select(el.id, false);
        beginEdit(elNode, el);
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
    beginEdit,
  };
})();
