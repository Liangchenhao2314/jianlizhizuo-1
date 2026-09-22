/* ============================================================
 * app.js —— 入口：初始化、工具栏、菜单、文件导入、快捷键
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;

  function $(id) { return document.getElementById(id); }

  /* ---------- 导入文件分发 ---------- */
  function handleFile(file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') { RS.importers.importPDF(file); return; }
    if (ext === 'docx' || ext === 'doc') { RS.importers.importDOCX(file); return; }
    if (ext === 'json') {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          RS.importers.importProjectJSON(fr.result);
          RS.ui.toast('项目已导入', 'ok');
          RS.ui.renderPagePane();
        } catch (e) { RS.ui.toast('项目导入失败：' + e.message, 'err'); }
      };
      fr.readAsText(file, 'utf-8');
      return;
    }
    if (ext === 'md' || ext === 'txt') {
      const fr = new FileReader();
      fr.onload = () => {
        RS.importers.importMarkdown(fr.result, 'classic');
        RS.ui.toast('已从 Markdown 生成简历', 'ok');
      };
      fr.readAsText(file, 'utf-8');
      return;
    }
    RS.ui.toast('不支持的文件类型：' + ext, 'err');
  }

  /* ---------- JD 文件读取 ---------- */
  function handleJdFile(file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const ta = document.getElementById('aiJdText');
    if (!ta) return;
    if (ext === 'txt' || ext === 'md') {
      const fr = new FileReader();
      fr.onload = () => { ta.value = fr.result; RS.ui.toast('JD 已载入，点击「开始岗位优化」', 'ok'); };
      fr.readAsText(file, 'utf-8');
      return;
    }
    if (ext === 'pdf') {
      RS.ui.showLoading('正在提取 JD 文本…');
      file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: buf }).promise)
        .then(async pdf => {
          let text = '';
          for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            text += tc.items.map(it => it.str).join(' ') + '\n';
          }
          ta.value = text.trim();
          RS.ui.toast('JD 已载入（PDF 提取）', 'ok');
        })
        .catch(e => { RS.ui.toast('JD PDF 读取失败，请直接粘贴：' + e.message, 'err'); })
        .finally(() => RS.ui.hideLoading());
      return;
    }
    if (ext === 'docx' || ext === 'doc') {
      RS.ui.showLoading('正在转换并提取 JD…');
      const fd = new FormData();
      fd.append('file', file);
      fetch('/api/convert', { method: 'POST', body: fd })
        .then(r => { if (!r.ok) throw new Error('服务器未提供转换服务'); return r.arrayBuffer(); })
        .then(buf => pdfjsLib.getDocument({ data: buf }).promise)
        .then(async pdf => {
          let text = '';
          for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            text += tc.items.map(it => it.str).join(' ') + '\n';
          }
          ta.value = text.trim();
          RS.ui.toast('JD 已载入', 'ok');
        })
        .catch(e => { RS.ui.toast('JD Word 读取失败，请直接粘贴内容：' + e.message, 'err'); })
        .finally(() => RS.ui.hideLoading());
      return;
    }
    RS.ui.toast('JD 支持 txt / pdf / docx，或直接粘贴', 'warn');
  }

  /* ---------- 下拉菜单 ---------- */
  function setupDropdown(btnId, menuId) {
    const btn = $(btnId);
    const menu = $(menuId);
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown.open').forEach(d => { if (d.id !== menuId) d.classList.remove('open'); });
      menu.closest('.dropdown').classList.toggle('open');
    });
  }

  /* ---------- 工具栏动作 ---------- */
  function bindToolbar() {
    setupDropdown('btnImport', 'importMenu');
    setupDropdown('btnExport', 'exportMenu');

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });

    // 导入菜单
    document.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        b.closest('.dropdown') && b.closest('.dropdown').classList.remove('open');
        const act = b.dataset.act;
        const fi = $('fileInput');
        if (act === 'import-pdf') { fi.accept = '.pdf'; fi.click(); }
        else if (act === 'import-docx') { fi.accept = '.docx,.doc'; fi.click(); }
        else if (act === 'import-project') { fi.accept = '.json'; fi.click(); }
        else if (act === 'import-md') {
          const md = prompt('粘贴 Markdown 简历内容（# 姓名、## 板块标题、- 列表项）：', '# 姓名\n求职意向：…\n\n## 教育背景\n- 学校 ｜ 专业 ｜ 学历\n- 时间');
          if (md != null) { RS.importers.importMarkdown(md, 'classic'); RS.ui.toast('已生成简历', 'ok'); }
        }
        else if (act === 'templates') { RS.ui.switchTab('page'); }
        else if (act === 'blank') {
          RS.reset();
          RS.addPage();
          RS.ui.toast('已创建空白简历，点击「新增板块」或右上角 AI 开始', 'ok');
          RS.ui.switchTab('page');
        }
        else if (act === 'save-project') { RS.importers.exportProjectJSON(); RS.ui.toast('项目已保存为 .json 文件', 'ok'); }
        else if (act === 'new-reset') {
          RS.ui.confirmModal('将清空当前所有内容，是否继续？', () => { RS.reset(); RS.ui.toast('已清空', 'ok'); RS.ui.renderPagePane(); });
        }
      });
    });

    // 导出菜单
    document.querySelectorAll('#exportMenu [data-act]').forEach(b => {
      b.addEventListener('click', () => {
        b.closest('.dropdown').classList.remove('open');
        const act = b.dataset.act;
        if (act === 'export-pdf') RS.exporters.exportPDF();
        else if (act === 'export-png') RS.exporters.exportPNG(false);
        else if (act === 'export-png-pages') RS.exporters.exportPNG(true);
        else if (act === 'export-word') RS.exporters.exportWord();
        else if (act === 'export-md') RS.exporters.exportMarkdown();
        else if (act === 'copy-md') RS.exporters.copyMarkdown();
      });
    });

    $('btnAddSection').onclick = () => { RS.ui.switchTab('page'); };
    $('btnAiSettings').onclick = () => { RS.ui.switchTab('settings'); };
    $('btnUndo').onclick = () => RS.undo();
    $('btnRedo').onclick = () => RS.redo();
    $('zoomIn').onclick = () => RS.render.setZoom(RS.state.zoom * 1.15);
    $('zoomOut').onclick = () => RS.render.setZoom(RS.state.zoom / 1.15);
    $('zoomFit').onclick = () => RS.render.fitWidth();
    $('btnHighlight').onclick = () => {
      RS.state.highlight = !RS.state.highlight;
      document.body.classList.toggle('hl', RS.state.highlight);
      $('btnHighlight').classList.toggle('active', RS.state.highlight);
    };

    // 文件输入
    $('fileInput').onchange = () => { handleFile($('fileInput').files[0]); $('fileInput').value = ''; };
    $('jdInput').onchange = () => { handleJdFile($('jdInput').files[0]); $('jdInput').value = ''; };

    // 面板 Tab
    document.querySelectorAll('.panel-tabs button').forEach(b => {
      b.onclick = () => RS.ui.switchTab(b.dataset.tab);
    });

    // 空状态卡片
    document.querySelectorAll('.empty-card').forEach(c => {
      c.onclick = () => {
        const act = c.dataset.act;
        if (act === 'import-pdf') { const fi = $('fileInput'); fi.accept = '.pdf'; fi.click(); }
        else if (act === 'import-docx') { const fi = $('fileInput'); fi.accept = '.docx,.doc'; fi.click(); }
        else if (act === 'templates') RS.ui.switchTab('page');
      };
    });
  }

  /* ---------- 滚轮缩放 ---------- */
  function bindWheelZoom() {
    const area = $('canvasArea');
    area.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      RS.render.setZoom(RS.state.zoom * dir);
    }, { passive: false });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    RS.editor.init();
    bindToolbar();
    bindWheelZoom();
    RS.ui.updateUndoRedo();
    RS.ui.updateZoomLabel();
    RS.ui.renderAiPane();
    RS.ui.renderSettingsPane();
    RS.ui.renderStylePane();

    // 自动保存恢复
    const autosave = RS.getAutosave();
    if (autosave && Array.isArray(autosave.pages) && autosave.pages.length && autosave.pages.some(p => p.elements.length)) {
      setTimeout(() => {
        RS.ui.confirmModal('检测到上次未完成的编辑（' + (autosave.projectName || '简历') + '），是否恢复？', () => {
          RS.restoreSnapshot(autosave);
          RS.ui.toast('已恢复上次编辑', 'ok');
          RS.ui.renderPagePane();
        }, '恢复');
      }, 400);
    }

    // 首次进入：创建空白 A4 页，便于用户立即点「新增板块」
    if (!RS.state.pages.length) {
      RS.addPage();
    }
    // 初始缩放适配宽度
    setTimeout(() => RS.render.fitWidth(), 60);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
