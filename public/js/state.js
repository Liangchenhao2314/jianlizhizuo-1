/* ============================================================
 * state.js —— 全局状态、元素 CRUD、撤销/重做、自动保存、设置
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;
  let uidCounter = 1;
  RS.uid = function (prefix) {
    return (prefix || 'e') + '_' + Date.now().toString(36) + '_' + (uidCounter++);
  };
  // 确保每个元素都有 id 与 page 归属（导入管线直接构造元素时可能遗漏）
  RS.ensureIds = function () {
    for (const p of RS.state.pages) {
      for (const e of p.elements) {
        if (!e.id) e.id = RS.uid(e.type === 'text' ? 't' : e.type === 'image' ? 'i' : 's');
        if (e.page !== p.id) e.page = p.id;
      }
    }
  };

  /* ---------- 设置 ---------- */
  const DEFAULT_SETTINGS = {
    provider: 'deepseek',
    model: '',
    baseUrl: '',
    apiKey: '',
    useServerProxy: true,
    temperature: 0.4,
  };

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('rs_settings') || 'null');
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  RS.saveSettings = function () {
    try { localStorage.setItem('rs_settings', JSON.stringify(RS.settings)); } catch (e) {}
  };

  /* ---------- 状态 ---------- */
  RS.state = {
    pages: [],                 // [{id, w, h, noCanvas, elements:[], ghosts:[]}]
    pageW: 210, pageH: 297,    // 默认 A4 mm
    zoom: 1.2,
    selected: [],              // 选中的元素 id 数组
    highlight: false,          // 原文框高亮
    settings: loadSettings(),
    projectName: '未命名简历',
    sourceInfo: null,
    dirty: false,
  };

  const undoStack = [];
  const redoStack = [];
  let autosaveTimer = null;

  /* ---------- 基础查询 ---------- */
  RS.pageIndex = function (pageId) {
    return RS.state.pages.findIndex(p => p.id === pageId);
  };
  RS.getPage = function (pageId) {
    return RS.state.pages.find(p => p.id === pageId);
  };
  RS.getEl = function (id) {
    for (const p of RS.state.pages) {
      const el = p.elements.find(e => e.id === id);
      if (el) return el;
    }
    return null;
  };
  RS.allElements = function () {
    const out = [];
    for (const p of RS.state.pages) for (const e of p.elements) out.push(e);
    return out;
  };
  RS.byZ = function (arr) {
    return arr.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  };

  /* ---------- 撤销/重做 ---------- */
  function snapshot() {
    return JSON.parse(JSON.stringify({
      pages: RS.state.pages,
      pageW: RS.state.pageW,
      pageH: RS.state.pageH,
      projectName: RS.state.projectName,
    }));
  }
  function restore(snap) {
    // 撤销/重做后保留仍存在的选中元素，避免"改完看不到选中标签在哪"
    const keep = RS.state.selected.filter(id => snap.pages.some(p => p.elements.some(e => e.id === id)));
    RS.state.pages = snap.pages;
    RS.state.pageW = snap.pageW;
    RS.state.pageH = snap.pageH;
    RS.state.projectName = snap.projectName;
    RS.state.selected = keep.length ? keep : [];
    RS.state.dirty = true;
    if (RS.render) RS.render.renderAll();
    if (RS.ui) { RS.ui.updateUndoRedo(); RS.ui.renderStylePane(); if (!keep.length) RS.ui.hideFloatBar(); }
  }
  // 基线快照：任何操作前的初始状态，保证 undo 可回到最初
  function pushBaseline() {
    if (!undoStack.length) undoStack.push(snapshot());
  }
  // 载入新文档/清空时重置历史
  RS.historyReset = function () {
    undoStack.length = 0;
    redoStack.length = 0;
    pushBaseline();
  };
  RS.commit = function (label, noRender) {
    pushBaseline();
    undoStack.push(snapshot());
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    RS.state.dirty = true;
    if (RS.render && !noRender) RS.render.renderAll();
    if (RS.ui) RS.ui.updateUndoRedo();
    scheduleAutosave();
  };
  RS.undo = function () {
    if (undoStack.length <= 1) return false; // 只剩基线，无可撤销
    redoStack.push(snapshot());
    undoStack.pop();
    restore(undoStack[undoStack.length - 1]);
    scheduleAutosave();
    return true;
  };
  RS.redo = function () {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    scheduleAutosave();
    return true;
  };
  RS.canUndo = function () { return undoStack.length > 0; };
  RS.canRedo = function () { return redoStack.length > 0; };

  /* ---------- 自动保存 ---------- */
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveAutosave, 800);
  }
  function saveAutosave() {
    try {
      const data = snapshot();
      data.settings = Object.assign({}, RS.state.settings, { apiKey: '' });
      data.time = Date.now();
      data.sourceInfo = RS.state.sourceInfo;
      localStorage.setItem('rs_autosave', JSON.stringify(data));
    } catch (e) {}
  }
  RS.getAutosave = function () {
    try { return JSON.parse(localStorage.getItem('rs_autosave') || 'null'); } catch (e) { return null; }
  };
  RS.clearAutosave = function () {
    try { localStorage.removeItem('rs_autosave'); } catch (e) {}
  };
  RS.restoreSnapshot = function (data) {
    if (!data || !Array.isArray(data.pages)) return false;
    RS.historyReset();
    RS.state.pages = data.pages;
    RS.state.pageW = data.pageW || 210;
    RS.state.pageH = data.pageH || 297;
    RS.state.projectName = data.projectName || '未命名简历';
    RS.state.sourceInfo = data.sourceInfo || null;
    RS.state.selected = [];
    RS.render.clearCanvases();
    RS.render.renderAll();
    RS.state.dirty = false;
    RS.clearAutosave();
    if (RS.ui) { RS.ui.updateUndoRedo(); RS.ui.renderStylePane(); }
    return true;
  };

  /* ---------- 元素 CRUD ---------- */
  function nextZ(page) {
    let z = 0;
    for (const e of page.elements) if ((e.z || 0) >= z) z = e.z + 1;
    return z;
  }
  RS.addElement = function (pageId, el, silent) {
    const page = RS.getPage(pageId);
    if (!page) return null;
    el.id = el.id || RS.uid(el.type === 'text' ? 't' : el.type === 'image' ? 'i' : 's');
    el.page = pageId;
    if (typeof el.z !== 'number') el.z = nextZ(page);
    if (typeof el.x !== 'number') el.x = 15;
    if (typeof el.y !== 'number') el.y = 15;
    if (typeof el.w !== 'number') el.w = 80;
    if (typeof el.h !== 'number') el.h = 6;
    page.elements.push(el);
    if (!silent) RS.commit();
    return el;
  };
  RS.removeElements = function (ids) {
    for (const id of ids) {
      for (const p of RS.state.pages) {
        const idx = p.elements.findIndex(e => e.id === id);
        if (idx >= 0) {
          const el = p.elements[idx];
          // 删除时若该元素曾遮挡过原版内容，记录 ghost 以便后续白底覆盖
          if (el.original && !p.ghosts.some(g => g.id === el.id)) p.ghosts.push({ id: el.id, x: el.original.x, y: el.original.y, w: el.original.w, h: el.original.h });
          p.elements.splice(idx, 1);
        }
      }
    }
    RS.state.selected = RS.state.selected.filter(id => !ids.includes(id));
    RS.commit();
  };
  RS.updateEl = function (id, patch) {
    const el = RS.getEl(id);
    if (!el) return;
    Object.assign(el, patch);
    if (RS.render) RS.render.renderAll();
  };
  RS.setSelected = function (ids) {
    RS.state.selected = ids.slice();
    if (RS.ui) RS.ui.renderStylePane();
    if (RS.editor) RS.editor.updateSelectionUI();
  };
  RS.moveZ = function (id, dir) {
    const page = RS.getPage(RS.getEl(id).page);
    const idx = page.elements.findIndex(e => e.id === id);
    if (idx < 0) return;
    const arr = page.elements;
    if (dir === 'top') { const el = arr.splice(idx, 1)[0]; arr.push(el); }
    else if (dir === 'bottom') { const el = arr.splice(idx, 1)[0]; arr.unshift(el); }
    else if (dir === 'up' && idx < arr.length - 1) { const t = arr[idx]; arr[idx] = arr[idx + 1]; arr[idx + 1] = t; }
    else if (dir === 'down' && idx > 0) { const t = arr[idx]; arr[idx] = arr[idx - 1]; arr[idx - 1] = t; }
    arr.forEach((e, i) => { e.z = i; });
    RS.commit();
  };
  RS.duplicate = function (ids) {
    const copies = [];
    for (const id of ids) {
      const el = RS.getEl(id);
      if (!el) continue;
      const copy = JSON.parse(JSON.stringify(el));
      delete copy.id;
      copy.x += 3; copy.y += 3;
      copy.original = null;
      copy.dirty = false;
      copy.forceVisible = false;
      copies.push(RS.addElement(el.page, copy, true));
    }
    if (copies.length) { RS.setSelected(copies.map(c => c.id)); RS.commit(); }
  };

  /* ---------- 页面管理 ---------- */
  RS.addPage = function (w, h) {
    const page = { id: RS.uid('p'), w: w || RS.state.pageW, h: h || RS.state.pageH, elements: [], ghosts: [] };
    RS.state.pages.push(page);
    RS.commit();
    return page;
  };
  RS.deletePage = function (pageId) {
    const idx = RS.pageIndex(pageId);
    if (idx < 0 || RS.state.pages.length <= 1) return;
    RS.state.pages.splice(idx, 1);
    RS.state.selected = [];
    RS.render.clearCanvases();
    RS.commit();
  };
  RS.movePage = function (pageId, dir) {
    const idx = RS.pageIndex(pageId);
    const arr = RS.state.pages;
    const t = arr[idx];
    if (dir === 'up' && idx > 0) { arr[idx] = arr[idx - 1]; arr[idx - 1] = t; }
    if (dir === 'down' && idx < arr.length - 1) { arr[idx] = arr[idx + 1]; arr[idx + 1] = t; }
    RS.commit();
  };
  RS.moveElToPage = function (id, pageId) {
    const el = RS.getEl(id);
    if (!el || el.page === pageId) return;
    const oldPage = RS.getPage(el.page);
    oldPage.elements = oldPage.elements.filter(e => e.id !== id);
    if (el.original && !oldPage.ghosts.some(g => g.id === el.id)) oldPage.ghosts.push({ id: el.id, x: el.original.x, y: el.original.y, w: el.original.w, h: el.original.h });
    el.page = pageId;
    RS.getPage(pageId).elements.push(el);
    RS.commit();
  };
  RS.reset = function () {
    undoStack.length = 0; redoStack.length = 0;
    RS.state.pages = [];
    RS.state.selected = [];
    RS.state.projectName = '未命名简历';
    RS.state.sourceInfo = null;
    RS.render.clearCanvases();
    RS.render.renderAll();
    RS.clearAutosave();
    if (RS.ui) { RS.ui.updateUndoRedo(); RS.ui.renderStylePane(); RS.ui.renderPagePane(); }
  };
})();
