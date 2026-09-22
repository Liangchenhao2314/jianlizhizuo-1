/* ============================================================
 * ui.js —— 面板 / 弹窗 / Toast / 各标签页渲染
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;

  const FONTS = ['SimSun', 'SimHei', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Times New Roman', 'Calibri', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Garamond', 'Consolas', 'Cambria'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ================= Toast / Loading ================= */
  function toast(msg, type) {
    const box = document.getElementById('toasts');
    const d = document.createElement('div');
    d.className = 'toast' + (type ? ' ' + type : '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => d.remove(), 3000);
  }
  function showLoading(text) {
    const o = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = text || '处理中…';
    o.classList.remove('hidden');
  }
  function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  /* ================= 弹窗 ================= */
  function openModal(opts) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const modal = document.createElement('div');
    modal.className = 'modal' + (opts.wide ? ' wide' : '');
    modal.innerHTML =
      '<div class="modal-head"><h3>' + esc(opts.title || '') + '</h3><button class="x" data-close>×</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '');
    mask.appendChild(modal);
    root.appendChild(mask);
    const close = () => root.innerHTML = '';
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    modal.querySelector('[data-close]').onclick = close;
    if (opts.onMount) opts.onMount(modal, close);
    return close;
  }
  function confirmModal(message, onOk, okLabel) {
    openModal({
      title: '确认操作',
      body: '<p style="line-height:1.7;font-size:13px;">' + esc(message) + '</p>',
      foot: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>' + esc(okLabel || '确认') + '</button>',
      onMount(modal, close) {
        modal.querySelector('[data-cancel]').onclick = close;
        modal.querySelector('[data-ok]').onclick = () => { close(); onOk && onOk(); };
      },
    });
  }

  /* ================= Tab 切换 ================= */
  function switchTab(name) {
    document.querySelectorAll('.panel-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'style') renderStylePane();
    if (name === 'page') renderPagePane();
  }

  /* ================= 样式面板 ================= */
  function renderStylePane() {
    const pane = document.getElementById('tab-style');
    const ids = RS.state.selected;
    const els = ids.map(id => RS.getEl(id)).filter(Boolean);
    if (!els.length) {
      pane.innerHTML =
        '<div class="empty-pane">' +
        '<b>尚未选中元素</b>' +
        '在左侧画布点击任意文字 / 图片 / 分割线即可编辑。<br><br>' +
        '技巧：<br>' +
        '· 双击文字 = 直接改内容<br>' +
        '· 拖动 = 移动位置，8 个手柄 = 缩放<br>' +
        '· 选中后点右上「AI 优化」可智能改写<br>' +
        '· 支持 Ctrl+Z 撤销、Ctrl+D 复制、Delete 删除' +
        '</div>';
      return;
    }
    const el = els[0];
    const multi = els.length > 1;
    let h = '';
    h += '<div class="panel-title">内容</div>';
    if (el.type === 'text') {
      h += '<div class="field"><label>文本内容（或双击画布直接编辑）</label><textarea id="propText" rows="4">' + esc(el.text || '') + '</textarea></div>';
    } else if (el.type === 'html') {
      h += '<div class="note">HTML 块：双击画布即可编辑表格/列表内容。</div>';
    } else if (el.type === 'image') {
      h += '<div class="field"><label>图片</label><button class="btn" id="propReplaceImg" style="width:100%;">替换图片…</button></div>';
    }

    h += '<div class="panel-title">文字样式</div>';
    h += '<div class="field"><label>字体</label><select id="propFont">' + FONTS.map(f => '<option value="' + f + '"' + (el.fontFamily === f ? ' selected' : '') + '>' + f + '</option>').join('') + '</select></div>';
    h += '<div class="prop-grid">';
    h += '<div class="field"><label>字号 (pt)</label><input type="number" id="propSize" value="' + (el.fontSizePt || 10) + '" min="4" max="120"></div>';
    h += '<div class="field"><label>行高</label><input type="number" id="propLineH" step="0.05" min="0.8" max="4" value="' + (el.lineHeight || 1.25) + '"></div>';
    h += '<div class="field"><label>字间距 (pt)</label><input type="number" id="propLetter" step="0.1" min="0" max="10" value="' + (el.letterSpacingPt || 0) + '"></div>';
    h += '<div class="field"><label>对齐</label><div class="seg" id="propAlign">' +
      [['left', '左'], ['center', '中'], ['right', '右'], ['justify', '两端']].map(([v, l]) => '<button data-v="' + v + '" class="' + (el.align === v ? 'active' : '') + '">' + l + '</button>').join('') +
      '</div></div>';
    h += '</div>';

    h += '<div class="panel-title">效果</div>';
    h += '<div class="seg" id="propTextStyle">' +
      '<button data-k="bold" class="' + (el.bold ? 'active' : '') + '">加粗</button>' +
      '<button data-k="italic" class="' + (el.italic ? 'active' : '') + '">斜体</button>' +
      '<button data-k="underline" class="' + (el.underline ? 'active' : '') + '">下划线</button>' +
      '</div>';
    h += '<div class="field" style="margin-top:8px;"><label>文字颜色</label><div class="color-inline"><input type="color" id="propColor" value="' + (el.color || '#000000') + '"><input type="text" id="propColorText" value="' + esc(el.color || '#000000') + '"></div></div>';
    if (el.type === 'text' || el.type === 'html') {
      h += '<div class="field"><label>背景色（可空）</label><div class="color-inline"><input type="color" id="propBg" value="' + (el.bgColor || '#ffffff') + '"><input type="text" id="propBgText" value="' + esc(el.bgColor || '') + '"></div></div>';
    }

    if (el.type === 'divider') {
      h += '<div class="panel-title">分割线</div>';
      h += '<div class="field"><label>颜色</label><div class="color-inline"><input type="color" id="propDvColor" value="' + (el.color || '#000000') + '"></div></div>';
      h += '<div class="field"><label>粗细 (px)</label><input type="number" id="propDvThick" min="0.5" max="20" step="0.5" value="' + (el.thickness || 1) + '"></div>';
      h += '<div class="field"><label><input type="checkbox" id="propDvDash"' + (el.dash ? ' checked' : '') + '> 虚线</label></div>';
    }
    if (el.type === 'shape') {
      h += '<div class="panel-title">形状</div>';
      h += '<div class="field"><label>类型</label><div class="seg" id="propShapeType">' +
        [['rect', '矩形'], ['ellipse', '圆形']].map(([v, l]) => '<button data-v="' + v + '" class="' + (el.shapeType === v ? 'active' : '') + '">' + l + '</button>').join('') +
        '</div></div>';
      h += '<div class="field"><label>填充色</label><div class="color-inline"><input type="color" id="propShapeFill" value="' + (el.fill || '#ffffff') + '"></div></div>';
      h += '<div class="field"><label>边框色</label><div class="color-inline"><input type="color" id="propShapeBorder" value="' + (el.borderColor || '#000000') + '"></div></div>';
      h += '<div class="field"><label>边框粗细 (px)</label><input type="number" id="propShapeBorderW" min="0" max="20" value="' + (el.borderWidth || 0) + '"></div>';
    }

    h += '<div class="panel-title">位置与大小 (mm)</div>';
    h += '<div class="prop-grid">';
    h += '<div class="field"><label>X</label><input type="number" id="propX" step="0.5" value="' + Math.round(el.x * 10) / 10 + '"></div>';
    h += '<div class="field"><label>Y</label><input type="number" id="propY" step="0.5" value="' + Math.round(el.y * 10) / 10 + '"></div>';
    h += '<div class="field"><label>宽</label><input type="number" id="propW" step="0.5" min="1" value="' + Math.round(el.w * 10) / 10 + '"></div>';
    h += '<div class="field"><label>高</label><input type="number" id="propH" step="0.5" min="1" value="' + Math.round(el.h * 10) / 10 + '"></div>';
    h += '<div class="field"><label>旋转 (°)</label><input type="number" id="propRot" step="1" min="0" max="360" value="' + (el.rotation || 0) + '"></div>';
    h += '<div class="field"><label>透明度 %</label><input type="number" id="propOpacity" step="5" min="5" max="100" value="' + Math.round((typeof el.opacity === 'number' ? el.opacity : 1) * 100) + '"></div>';
    h += '</div>';

    h += '<div class="panel-title">层级 / 操作</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    h += '<button class="btn btn-sm" data-z="top">置顶</button><button class="btn btn-sm" data-z="up">上移</button><button class="btn btn-sm" data-z="down">下移</button><button class="btn btn-sm" data-z="bottom">置底</button>';
    h += '<button class="btn btn-sm" id="propDup">复制</button><button class="btn btn-sm btn-danger" id="propDel">删除</button>';
    h += '<button class="btn btn-sm" id="propLock">' + (el.locked ? '解锁' : '锁定') + '</button>';
    h += '</div>';
    h += multi ? '<div class="note" style="margin-top:8px;">已选中 ' + els.length + ' 个元素，修改将同时应用。</div>' : '';
    pane.innerHTML = h;
    bindStylePane(els, el);
  }

  function bindStylePane(els, el) {
    const first = els[0];
    const set = (patch) => {
      for (const e of els) Object.assign(e, patch);
      if (patch.text !== undefined) for (const e of els) { if (!e.original) e.original = { x: e.x, y: e.y, w: e.w, h: e.h }; e.dirty = true; }
      RS.render.renderAll();
      RS.commit();
    };
    const txt = document.getElementById('propText');
    if (txt) {
      let timer = null;
      txt.addEventListener('input', () => {
        first.text = txt.value;
        if (!first.original) { first.original = { x: first.x, y: first.y, w: first.w, h: first.h }; }
        first.dirty = true;
        const n = document.querySelector('.el[data-id="' + first.id + '"] .t');
        if (n) n.innerHTML = RS.render.textToHTML(txt.value);
        clearTimeout(timer);
        timer = setTimeout(() => RS.commit(), 600);
      });
    }
    const bindNum = (id, key, min, max, factor) => {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener('change', () => {
        let v = parseFloat(inp.value);
        if (isNaN(v)) return;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        set({ [key]: factor ? Math.round(v * factor * 10) / 10 : v });
      });
    };
    bindNum('propSize', 'fontSizePt', 4, 120);
    bindNum('propLineH', 'lineHeight', 0.8, 4);
    bindNum('propLetter', 'letterSpacingPt', 0, 10);
    bindNum('propX', 'x', -200, 500);
    bindNum('propY', 'y', -200, 500);
    bindNum('propW', 'w', 1, 500);
    bindNum('propH', 'h', 1, 500);
    bindNum('propRot', 'rotation', 0, 360);
    bindNum('propOpacity', 'opacity', 0.05, 1, 0.01);
    bindNum('propDvThick', 'thickness', 0.5, 20);

    const font = document.getElementById('propFont');
    if (font) font.onchange = () => set({ fontFamily: font.value });
    const align = document.getElementById('propAlign');
    if (align) align.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { set({ align: b.dataset.v }); renderStylePane(); } });
    const tstyle = document.getElementById('propTextStyle');
    if (tstyle) tstyle.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k;
      const cur = els.every(x => x[k]) ? true : !els[0][k];
      set({ [k]: !els[0][k] });
      renderStylePane();
    });
    const color = document.getElementById('propColor');
    if (color) {
      color.oninput = () => { set({ color: color.value }); const t = document.getElementById('propColorText'); if (t) t.value = color.value; };
      const ct = document.getElementById('propColorText');
      if (ct) ct.onchange = () => { const v = ct.value.trim(); if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { color.value = v; set({ color: v }); } };
    }
    const bg = document.getElementById('propBg');
    if (bg) {
      bg.oninput = () => { set({ bgColor: bg.value }); const t = document.getElementById('propBgText'); if (t) t.value = bg.value; };
      const bt = document.getElementById('propBgText');
      if (bt) bt.onchange = () => { set({ bgColor: bt.value.trim() || undefined }); };
    }
    const dvColor = document.getElementById('propDvColor');
    if (dvColor) dvColor.oninput = () => set({ color: dvColor.value });
    const dvDash = document.getElementById('propDvDash');
    if (dvDash) dvDash.onchange = () => set({ dash: dvDash.checked });
    const shapeType = document.getElementById('propShapeType');
    if (shapeType) shapeType.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { set({ shapeType: b.dataset.v }); renderStylePane(); } });
    const shF = document.getElementById('propShapeFill');
    if (shF) shF.oninput = () => set({ fill: shF.value });
    const shB = document.getElementById('propShapeBorder');
    if (shB) shB.oninput = () => set({ borderColor: shB.value });
    bindNum('propShapeBorderW', 'borderWidth', 0, 20);

    const zBtns = document.querySelectorAll('[data-z]');
    zBtns.forEach(b => b.onclick = () => { RS.moveZ(first.id, b.dataset.z); });
    const dup = document.getElementById('propDup');
    if (dup) dup.onclick = () => RS.duplicate(RS.state.selected.slice());
    const del = document.getElementById('propDel');
    if (del) del.onclick = () => RS.removeElements(RS.state.selected.slice());
    const lock = document.getElementById('propLock');
    if (lock) lock.onclick = () => { set({ locked: !first.locked }); renderStylePane(); };
    const repImg = document.getElementById('propReplaceImg');
    if (repImg) repImg.onclick = () => chooseImageFor(first.id);
  }

  /* ---------- 图片替换 ---------- */
  function chooseImageFor(id) {
    const inp = document.getElementById('imageInput');
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const el = RS.getEl(id);
        if (!el) return;
        el.src = fr.result;
        el.dirty = true;
        if (!el.original) el.original = { x: el.x, y: el.y, w: el.w, h: el.h };
        RS.render.renderAll();
        RS.commit();
        RS.ui.toast('图片已替换', 'ok');
      };
      fr.readAsDataURL(f);
      inp.value = '';
    };
    inp.click();
  }

  /* ================= 页面 / 模板面板 ================= */
  function renderPagePane() {
    const pane = document.getElementById('tab-page');
    const tpls = RS.templates;
    let h = '';
    h += '<div class="panel-title">模板库（新建简历）</div>';
    h += '<div class="tpl-grid">';
    for (const key of Object.keys(tpls)) {
      const t = tpls[key];
      h += '<div class="tpl-card" data-tpl="' + key + '"><div class="tpl-prev">' +
        '<i style="width:38%"></i><i style="width:60%"></i><i style="width:46%"></i><i style="width:70%"></i>' +
        '</div><div class="tpl-info"><b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small></div></div>';
    }
    h += '</div>';

    h += '<div class="panel-title">新增板块</div>';
    h += '<div class="section-grid">';
    for (const key of Object.keys(RS.sections)) {
      h += '<button data-sec="' + esc(key) + '">+ ' + esc(key) + '</button>';
    }
    h += '</div>';

    h += '<div class="panel-title">页面管理</div>';
    h += '<div id="pageList">';
    RS.state.pages.forEach((p, i) => {
      h += '<div class="page-item" data-page="' + p.id + '">' +
        '<span class="pi-no">' + (i + 1) + '</span>' +
        '<span class="pi-name">' + Math.round((p.w || RS.state.pageW)) + '×' + Math.round((p.h || RS.state.pageH)) + ' mm</span>' +
        '<button data-page-act="up" title="上移">↑</button>' +
        '<button data-page-act="down" title="下移">↓</button>' +
        '<button data-page-act="del" class="del" title="删除页">×</button>' +
        '</div>';
    });
    h += '</div>';
    h += '<button class="btn" id="addPage" style="width:100%;margin-top:4px;">＋ 添加新页</button>';

    h += '<div class="panel-title">页面尺寸</div>';
    h += '<div class="field"><select id="pageSizeSel">' +
      '<option value="210,297">A4（210×297mm）</option>' +
      '<option value="148,210">A5（148×210mm）</option>' +
      '<option value="216,279">Letter（216×279mm）</option>' +
      '<option value="custom">自定义…</option>' +
      '</select></div>';
    h += '<div class="prop-grid" id="customSize" style="display:none;">' +
      '<div class="field"><label>宽 mm</label><input type="number" id="cusW" value="210" min="50" max="600"></div>' +
      '<div class="field"><label>高 mm</label><input type="number" id="cusH" value="297" min="50" max="900"></div>' +
      '</div>';
    h += '<button class="btn" id="applySize" style="width:100%;margin-top:6px;">应用到全部页面</button>';

    pane.innerHTML = h;

    pane.querySelectorAll('.tpl-card').forEach(c => {
      c.onclick = () => {
        const key = c.dataset.tpl;
        if (RS.state.pages.length && RS.state.pages.some(p => p.elements.length)) {
          confirmModal('模板新建会替换当前简历，是否继续？', () => useTemplate(key));
        } else useTemplate(key);
      };
    });
    pane.querySelectorAll('[data-sec]').forEach(b => {
      b.onclick = () => {
        if (!RS.state.pages.length) { RS.ui.toast('请先新建或导入简历', 'warn'); return; }
        RS.insertSection(b.dataset.sec);
        RS.ui.toast('已插入板块：' + b.dataset.sec + '（可拖动调整位置）', 'ok');
      };
    });
    pane.querySelectorAll('[data-page-act]').forEach(b => {
      b.onclick = () => {
        const pageId = b.closest('.page-item').dataset.page;
        const act = b.dataset.pageAct;
        if (act === 'del') {
          if (RS.state.pages.length <= 1) { RS.ui.toast('至少保留一页', 'warn'); return; }
          RS.deletePage(pageId);
        } else RS.movePage(pageId, act);
      };
    });
    document.getElementById('addPage').onclick = () => { RS.addPage(); RS.ui.toast('已添加新页', 'ok'); };
    const sel = document.getElementById('pageSizeSel');
    const cus = document.getElementById('customSize');
    sel.onchange = () => { cus.style.display = sel.value === 'custom' ? 'grid' : 'none'; };
    document.getElementById('applySize').onclick = () => {
      let w, h;
      if (sel.value === 'custom') {
        w = parseFloat(document.getElementById('cusW').value) || 210;
        h = parseFloat(document.getElementById('cusH').value) || 297;
      } else {
        [w, h] = sel.value.split(',').map(Number);
      }
      for (const p of RS.state.pages) { p.w = w; p.h = h; }
      RS.state.pageW = w; RS.state.pageH = h;
      RS.render.renderAll();
      RS.commit();
      RS.ui.toast('页面尺寸已更新为 ' + w + '×' + h + ' mm', 'ok');
    };
  }

  const TEMPLATE_MD = {
    classic: '# 张三\n求职意向：产品经理｜现居北京\n\n## 教育背景\n- 北京大学 信息管理与信息系统 ｜ 本科\n- 2020.09 – 2024.06\n- GPA 3.85/4.00，专业前 5%\n\n## 实习经历\n- 星月岛 ｜ 用户增长产品经理实习生\n- 2023.09 – 2024.03\n- 负责新用户激活漏斗优化，推动首单转化率提升 12%\n\n## 项目经历\n- 用户增长实验平台设计 ｜ 独立项目\n- 2023.10 – 2024.01\n- 设计覆盖实验创建、流量分配、指标配置的实验平台原型\n\n## 技能特长\n- 产品：需求分析、用户分层、A/B 实验、PRD 撰写\n- 数据：SQL、Excel、看板搭建\n- 工具：Figma、Axure、飞书文档\n- 语言：英语 CET-6',
    modern: '# 李四\n求职意向：数据分析师｜上海\n电话：138-0000-0000｜邮箱：lisi@email.com\n\n## 教育背景\n- 上海交通大学 统计与数据科学 ｜ 硕士\n- 2021.09 – 2024.06\n\n## 实习经历\n- 云图科技 ｜ 数据分析实习生\n- 2023.05 – 2023.11\n- 搭建用户行为分析看板，沉淀 20+ 指标口径\n\n## 项目经历\n- 电商复购预测模型 ｜ Kaggle 项目\n- 使用 XGBoost 建模，AUC 0.87，Top 5%\n\n## 技能特长\n- Python、SQL、Tableau、机器学习\n\n## 自我评价\n- 数据敏感，逻辑清晰，结果导向',
    academic: '# 王五\n研究方向：计算语言学｜博士在读\n\n## 教育背景\n- 复旦大学 中国语言文学 ｜ 博士\n- 2020.09 至今\n\n## 科研经历\n- 汉语情感计算语料库构建\n- 基于 BERT 的细粒度情感分析，发表论文 2 篇\n\n## 论文与成果\n- 论文一：发表于《中文信息学报》\n- 论文二：国际会议 ACL 投稿\n\n## 技能特长\n- Python、NLP、语料库建设、学术写作\n\n## 证书荣誉\n- 国家奖学金、优秀博士生',
  };

  function useTemplate(key) {
    RS.importers.importMarkdown(TEMPLATE_MD[key] || '', key);
    RS.ui.toast('已用「' + (RS.templates[key] || {}).name + '」模板新建简历', 'ok');
  }

  /* ================= 设置面板 ================= */
  function renderSettingsPane() {
    const pane = document.getElementById('tab-settings');
    const s = RS.state.settings;
    const p = RS.ai.PROVIDERS;
    let h = '';
    h += '<div class="panel-title">AI 服务配置</div>';
    h += '<div class="set-card">';
    h += '<div class="provider-radio">';
    for (const key of Object.keys(p)) {
      h += '<label class="' + (s.provider === key ? 'checked' : '') + '">' +
        '<input type="radio" name="provider" value="' + key + '"' + (s.provider === key ? ' checked' : '') + '>' +
        '<span>' + esc(p[key].label) + '</span></label>';
    }
    h += '</div>';
    h += '<div class="note" id="providerTip">' + esc(p[s.provider] ? p[s.provider].tip : '') + '</div>';
    h += '<div class="field" style="margin-top:10px;"><label>模型</label><input type="text" id="setModel" placeholder="留空使用默认模型" value="' + esc(s.model || '') + '"></div>';
    h += '<div class="field"><label>接口地址（OpenAI 兼容时填写）</label><input type="text" id="setBaseUrl" placeholder="https://api.openai.com/v1" value="' + esc(s.baseUrl || '') + '"></div>';
    h += '<div class="field"><label>API Key</label><input type="password" id="setApiKey" placeholder="sk-…" value="' + esc(s.apiKey || '') + '"></div>';
    h += '<div class="field"><label><input type="checkbox" id="setProxy"' + (s.useServerProxy ? ' checked' : '') + '> 服务端代理模式（密钥存服务器，站点访客无需填 Key）</label></div>';
    h += '<div class="field"><label>温度 <output id="setTempOut">' + (s.temperature || 0.4) + '</output></label><input type="range" id="setTemp" min="0" max="1" step="0.1" value="' + (s.temperature || 0.4) + '"></div>';
    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn primary" id="saveSet" style="flex:1;">保存设置</button>';
    h += '<button class="btn" id="testSet">测试连接</button>';
    h += '</div>';
    h += '</div>';

    h += '<div class="panel-title">数据与隐私</div>';
    h += '<div class="set-card"><div class="note">' +
      '简历内容默认仅在当前浏览器本地处理：<br>' +
      '· 解析、渲染、编辑、导出全部在本机完成<br>' +
      '· 自动保存在浏览器本地存储，换设备/浏览器不共享<br>' +
      '· 仅当你点击「AI 优化」时，内容才会发送到你配置的 AI 服务<br>' +
      '<b>可接入：</b>豆包（火山方舟）、DeepSeek、千问（通义）、任意 OpenAI 兼容接口。' +
      '</div></div>';

    h += '<div class="panel-title">数据管理</div>';
    h += '<div class="set-card">';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    h += '<button class="btn btn-sm" id="restoreAuto">恢复上次自动保存</button>';
    h += '<button class="btn btn-sm btn-danger" id="resetAll">清空当前简历</button>';
    h += '</div>';
    h += '<div class="note" style="margin-top:8px;">「导出 → 保存项目」可把完整项目下载为 .json，随时重新导入继续编辑。</div>';
    h += '</div>';

    h += '<div class="panel-title">关于</div>';
    h += '<div class="set-card"><div class="note">' +
      '智简简历 · AI Resume Studio v1.0<br>' +
      '界面灵感来自 gracexygu.github.io/resume-formatter（简历排版器）。<br>' +
      '开源部署：GitHub + Railway。' +
      '</div></div>';

    pane.innerHTML = h;

    const radios = pane.querySelectorAll('input[name="provider"]');
    radios.forEach(r => r.onchange = () => {
      pane.querySelectorAll('.provider-radio label').forEach(l => l.classList.remove('checked'));
      r.closest('label').classList.add('checked');
      document.getElementById('providerTip').textContent = p[r.value].tip;
      const base = document.getElementById('setBaseUrl');
      if (r.value !== 'openai') base.value = p[r.value].base;
    });
    const temp = document.getElementById('setTemp');
    temp.oninput = () => { document.getElementById('setTempOut').textContent = temp.value; };
    document.getElementById('saveSet').onclick = () => {
      const active = pane.querySelector('input[name="provider"]:checked');
      RS.state.settings.provider = active ? active.value : 'deepseek';
      RS.state.settings.model = document.getElementById('setModel').value.trim();
      RS.state.settings.baseUrl = document.getElementById('setBaseUrl').value.trim();
      RS.state.settings.apiKey = document.getElementById('setApiKey').value.trim();
      RS.state.settings.useServerProxy = document.getElementById('setProxy').checked;
      RS.state.settings.temperature = parseFloat(temp.value) || 0.4;
      RS.saveSettings();
      RS.ui.toast('设置已保存', 'ok');
    };
    document.getElementById('testSet').onclick = () => {
      const active = pane.querySelector('input[name="provider"]:checked');
      RS.state.settings.provider = active ? active.value : 'deepseek';
      RS.state.settings.model = document.getElementById('setModel').value.trim();
      RS.state.settings.baseUrl = document.getElementById('setBaseUrl').value.trim();
      RS.state.settings.apiKey = document.getElementById('setApiKey').value.trim();
      RS.state.settings.useServerProxy = document.getElementById('setProxy').checked;
      RS.state.settings.temperature = parseFloat(temp.value) || 0.4;
      RS.saveSettings();
      RS.ai.testConnection();
    };
    document.getElementById('restoreAuto').onclick = () => {
      const data = RS.getAutosave();
      if (!data || !data.pages || !data.pages.length) { RS.ui.toast('没有可恢复的自动保存', 'warn'); return; }
      confirmModal('恢复后当前内容将被自动保存的版本替换，是否继续？', () => {
        RS.restoreSnapshot(data);
        RS.ui.toast('已恢复自动保存的版本', 'ok');
        renderPagePane();
      });
    };
    document.getElementById('resetAll').onclick = () => {
      confirmModal('将清空当前所有页面与内容（不可恢复），是否继续？', () => {
        RS.reset();
        RS.ui.toast('已清空', 'ok');
        renderPagePane();
      });
    };
  }

  /* ================= AI 面板 ================= */
  function renderAiPane() {
    const pane = document.getElementById('tab-ai');
    pane.innerHTML =
      '<div class="ai-hero"><h3>AI 智能优化</h3><p>粘贴目标岗位 JD → AI 分析匹配度并逐条给出简历改写建议，你确认后再应用；也可润色选中段落、或直接与 AI 对话。</p></div>' +
      '<div class="ai-block"><h4>岗位定向优化 <span class="tag">核心功能</span></h4>' +
      '<textarea id="aiJdText" placeholder="把目标岗位 JD（职位描述）粘贴到这里…也可以上传 JD 文件（txt / pdf / docx）"></textarea>' +
      '<div class="ai-actions">' +
      '<button class="btn btn-sm" id="aiJdUpload">上传 JD 文件</button>' +
      '<button class="btn btn-sm" id="aiJdSample">示例 JD</button>' +
      '</div>' +
      '<div class="ai-actions">' +
      '<button class="btn-ai" id="aiRunJd">开始岗位优化</button>' +
      '<button class="btn-ghost" id="aiRunAts">ATS 匹配度分析</button>' +
      '</div>' +
      '<div id="aiJdResult"></div></div>' +
      '<div class="ai-block"><h4>选中内容润色</h4>' +
      '<div class="field"><label>润色风格</label><select id="aiPolishTone">' +
      Object.keys(RS.ai.POLISH_TONES).map(k => '<option value="' + k + '">' + RS.ai.POLISH_TONES[k] + '</option>').join('') +
      '</select></div>' +
      '<button class="btn-ai" id="aiRunPolish">润色选中内容</button>' +
      '<div class="note" style="margin-top:6px;">先在画布上点击选中一段文字（可多选），再点此按钮。</div></div>' +
      '<div class="ai-block"><h4>智能对话</h4>' +
      '<div class="chat-box" id="aiChatBox"><div class="msg ai">你好，我是简历助手。可以帮你：根据 JD 优化简历、润色某段内容、分析匹配度、解答求职问题。请直接提问～</div></div>' +
      '<div class="chat-input-row"><input id="aiChatInput" placeholder="例如：帮我根据这份 JD 优化实习经历…"><button class="btn primary" id="aiChatSend">发送</button></div>' +
      '<div class="chat-opts"><label><input type="checkbox" id="aiChatCtx" checked> 附带当前简历结构作为上下文</label></div>' +
      '</div>' +
      '<div class="note" style="font-size:11.5px;color:#9ca3af;">首次使用请先在「设置」标签页配置 AI 服务（豆包 / DeepSeek / 千问 / OpenAI 兼容）。</div>';

    document.getElementById('aiJdUpload').onclick = () => document.getElementById('jdInput').click();
    document.getElementById('aiJdSample').onclick = () => {
      document.getElementById('aiJdText').value = SAMPLE_JD;
      RS.ui.toast('已填入示例 JD，可修改后使用', 'ok');
    };
    document.getElementById('aiRunJd').onclick = () => RS.ai.runJDOptimize(document.getElementById('aiJdText').value);
    document.getElementById('aiRunAts').onclick = () => RS.ai.runATSAnalysis(document.getElementById('aiJdText').value);
    document.getElementById('aiRunPolish').onclick = () => RS.ai.runPolish(RS.state.selected.slice(), document.getElementById('aiPolishTone').value);
    document.getElementById('aiChatSend').onclick = () => sendChat();
    document.getElementById('aiChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  }

  const SAMPLE_JD = '【产品经理实习生】\n岗位职责：\n1. 负责 C 端产品的需求分析与产品设计，输出 PRD；\n2. 推动新用户增长策略落地，负责激活、留存等核心指标优化；\n3. 与研发、设计、运营紧密协作，跟进项目排期与上线；\n4. 通过数据分析驱动产品迭代，搭建数据看板。\n任职要求：\n1. 本科及以上学历，2025 届优先，有互联网产品实习经验；\n2. 熟悉 SQL，能独立完成数据分析；\n3. 具备 A/B 实验设计与结果解读能力；\n4. 逻辑清晰、沟通能力强，有责任心。';

  /* ---------- JD 优化结果渲染 ---------- */
  function renderJdResult(result, jdText) {
    const box = document.getElementById('aiJdResult');
    if (!box) return;
    let h = '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">';
    h += '<div class="panel-title">分析结果</div>';
    h += '<div class="match-verdict ' + (result.score >= 70 ? 'good' : result.score >= 45 ? 'mid' : 'low') + '">' +
      '匹配度评分：<b>' + Math.round(result.score || 0) + '/100</b><br>' + esc(result.analysis || '') + '</div>';

    if (Array.isArray(result.keywordMatch) && result.keywordMatch.length) {
      h += '<div class="panel-title">JD 关键词命中</div>';
      for (const k of result.keywordMatch.slice(0, 14)) {
        const pct = k.inResume ? 100 : 0;
        h += '<div class="match-bar-row"><span class="kw" title="' + esc(k.evidence || '') + '">' + esc(k.keyword) + '</span>' +
          '<span class="match-bar"><i style="width:' + pct + '%"></i></span><span class="pct">' + (k.inResume ? '命中' : '缺失') + '</span></div>';
      }
    }

    h += '<div class="panel-title">逐条改写建议（点击「应用」后生效，可撤销）</div>';
    const revs = Array.isArray(result.revisions) ? result.revisions : [];
    if (!revs.length) h += '<div class="note">AI 认为当前简历与该 JD 匹配良好，无需大幅改写。</div>';
    h += revs.length ? '<div class="ai-actions"><button class="btn-sm btn-ok" id="revApplyAll">全部应用</button><button class="btn-sm" id="revSkipAll">全部跳过</button></div>' : '';
    revs.forEach((rev, i) => {
      h += '<div class="rev-card" data-rev="' + i + '">' +
        '<div class="rev-old">' + esc(rev.old || '') + '</div>' +
        '<div class="rev-new">' + esc(rev.new || '') + '</div>' +
        '<div class="rev-reason">' + esc(rev.reason || '') + '</div>' +
        '<div class="rev-btns"><button class="btn-sm btn-ok" data-rev-act="apply">应用</button>' +
        '<button class="btn-sm" data-rev-act="skip">跳过</button></div></div>';
    });

    const adds = Array.isArray(result.additions) ? result.additions : [];
    if (adds.length) {
      h += '<div class="panel-title">建议新增</div>';
      adds.forEach((add, i) => {
        h += '<div class="rev-card" data-add="' + i + '">' +
          '<div class="rev-new-add">【' + esc(add.section || '') + '】' + esc(add.text || '') + '</div>' +
          '<div class="rev-reason">' + esc(add.reason || '') + '</div>' +
          '<div class="rev-btns"><button class="btn-sm btn-ok" data-add-act="apply">插入简历</button>' +
          '<button class="btn-sm" data-add-act="skip">跳过</button></div></div>';
      });
    }

    const rems = Array.isArray(result.removals) ? result.removals : [];
    if (rems.length) {
      h += '<div class="panel-title">建议删除</div>';
      rems.forEach((rem, i) => {
        const el = RS.getEl(rem.id);
        h += '<div class="rev-card" data-rem="' + i + '">' +
          '<div class="rev-old">' + esc(el ? el.text : '(元素不存在)') + '</div>' +
          '<div class="rev-reason">' + esc(rem.reason || '') + '</div>' +
          '<div class="rev-btns"><button class="btn-sm btn-danger" data-rem-act="apply">删除</button>' +
          '<button class="btn-sm" data-rem-act="skip">保留</button></div></div>';
      });
    }

    if (Array.isArray(result.suggestions) && result.suggestions.length) {
      h += '<div class="panel-title">差距与建议（无法靠改写解决）</div>';
      h += '<ul style="font-size:12px;line-height:1.8;padding-left:18px;color:var(--ink-2);">' + result.suggestions.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>';
    }
    h += '</div>';
    box.innerHTML = h;

    const stateMap = { applied: {}, skipped: {} };
    const markDone = (card) => { card.style.opacity = '.45'; card.style.pointerEvents = 'none'; };
    box.querySelectorAll('[data-rev]').forEach(card => {
      const idx = parseInt(card.dataset.rev, 10);
      const rev = revs[idx];
      card.querySelector('[data-rev-act="apply"]').onclick = () => {
        if (RS.ai.applyRevision(rev)) { stateMap.applied[idx] = true; markDone(card); RS.ui.toast('已应用该条改写', 'ok'); }
      };
      card.querySelector('[data-rev-act="skip"]').onclick = () => { stateMap.skipped[idx] = true; markDone(card); };
    });
    box.querySelectorAll('[data-add]').forEach(card => {
      const idx = parseInt(card.dataset.add, 10);
      const add = adds[idx];
      card.querySelector('[data-add-act="apply"]').onclick = () => {
        if (RS.ai.applyAddition(add)) { markDone(card); RS.ui.toast('已插入建议内容（可拖动微调）', 'ok'); }
      };
      card.querySelector('[data-add-act="skip"]').onclick = () => markDone(card);
    });
    box.querySelectorAll('[data-rem]').forEach(card => {
      const idx = parseInt(card.dataset.rem, 10);
      const rem = rems[idx];
      card.querySelector('[data-rem-act="apply"]').onclick = () => {
        RS.removeElements([rem.id]);
        markDone(card);
        RS.ui.toast('已删除该条内容', 'ok');
      };
      card.querySelector('[data-rem-act="skip"]').onclick = () => markDone(card);
    });
    const applyAll = document.getElementById('revApplyAll');
    if (applyAll) applyAll.onclick = () => {
      let n = 0;
      box.querySelectorAll('[data-rev]').forEach(card => {
        const idx = parseInt(card.dataset.rev, 10);
        const rev = revs[idx];
        if (stateMap.applied[idx] || stateMap.skipped[idx]) return;
        if (RS.ai.applyRevision(rev)) { n++; markDone(card); }
      });
      RS.ui.toast('已应用 ' + n + ' 条改写', 'ok');
    };
    const skipAll = document.getElementById('revSkipAll');
    if (skipAll) skipAll.onclick = () => {
      box.querySelectorAll('[data-rev]').forEach(card => { const idx = parseInt(card.dataset.rev, 10); stateMap.skipped[idx] = true; markDone(card); });
      RS.ui.toast('已跳过全部改写建议', 'ok');
    };
  }

  /* ---------- ATS 结果渲染 ---------- */
  function renderAtsResult(result) {
    const box = document.getElementById('aiJdResult');
    if (!box) return;
    let h = '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">';
    const score = Math.round(result.overall || 0);
    h += '<div class="match-verdict ' + (score >= 70 ? 'good' : score >= 45 ? 'mid' : 'low') + '">ATS 匹配度：<b>' + score + '/100</b><br>' + esc(result.summary || '') + '</div>';
    if (Array.isArray(result.keywordMatch) && result.keywordMatch.length) {
      h += '<div class="panel-title">关键词匹配明细</div>';
      for (const k of result.keywordMatch.slice(0, 16)) {
        const pct = k.inResume ? 100 : 0;
        h += '<div class="match-bar-row"><span class="kw" title="' + esc(k.evidence || '') + '">' + esc(k.keyword) + '</span>' +
          '<span class="match-bar"><i style="width:' + pct + '%"></i></span><span class="pct">' + (k.inResume ? '命中' : '缺失') + '</span></div>';
      }
    }
    if (Array.isArray(result.gaps) && result.gaps.length) {
      h += '<div class="panel-title">关键差距</div><ul style="font-size:12px;line-height:1.8;padding-left:18px;color:var(--ink-2);">' + result.gaps.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>';
    }
    if (Array.isArray(result.tips) && result.tips.length) {
      h += '<div class="panel-title">改进建议</div><ul style="font-size:12px;line-height:1.8;padding-left:18px;color:var(--ink-2);">' + result.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
    }
    h += '</div>';
    box.innerHTML = h;
  }

  /* ---------- 润色弹窗 ---------- */
  function showPolishModal(ids, original, result) {
    openModal({
      title: 'AI 润色结果',
      wide: true,
      body:
        '<div class="panel-title">原文</div>' +
        '<div style="background:#f9fafb;border-radius:8px;padding:10px;font-size:12.5px;line-height:1.6;color:var(--ink-3);white-space:pre-wrap;">' + esc(original) + '</div>' +
        '<div class="panel-title">润色后（可继续修改）</div>' +
        '<textarea id="polishNew" style="width:100%;min-height:120px;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12.5px;line-height:1.6;">' + esc(result.revised || '') + '</textarea>' +
        '<div class="panel-title">改动说明</div>' +
        '<div class="note">' + esc(result.reason || '') + '</div>',
      foot:
        '<button class="btn" data-close2>取消</button>' +
        '<button class="btn primary" id="polishApply">应用到简历</button>',
      onMount(modal, close) {
        modal.querySelector('[data-close2]').onclick = close;
        modal.querySelector('#polishApply').onclick = () => {
          const text = modal.querySelector('#polishNew').value;
          for (const id of ids) {
            const el = RS.getEl(id);
            if (!el) continue;
            el.text = text;
            if (!el.original) el.original = { x: el.x, y: el.y, w: el.w, h: el.h };
            el.dirty = true;
            el.aiModified = true;
          }
          RS.render.renderAll();
          RS.commit();
          RS.ui.toast('已应用润色（可 Ctrl+Z 撤销）', 'ok');
          close();
        };
      },
    });
  }

  /* ---------- 对话 ---------- */
  const chatHistory = [];
  function sendChat() {
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMsg('user', text);
    const withCtx = document.getElementById('aiChatCtx') ? document.getElementById('aiChatCtx').checked : true;
    const box = document.getElementById('aiChatBox');
    const pending = document.createElement('div');
    pending.className = 'msg ai';
    pending.textContent = '思考中…';
    box.appendChild(pending);
    box.scrollTop = box.scrollHeight;
    chatHistory.push({ role: 'user', content: text });
    RS.ai.chatSend(text, withCtx, chatHistory)
      .then(content => {
        chatHistory.push({ role: 'assistant', content });
        pending.remove();
        const edits = RS.ai.parseApply(content);
        appendMsg('ai', content, edits);
      })
      .catch(e => {
        pending.remove();
        appendMsg('ai', '请求失败：' + e.message);
        RS.ui.toast('AI 请求失败：' + e.message, 'err');
      });
  }
  function appendMsg(role, content, edits) {
    const box = document.getElementById('aiChatBox');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    const clean = content.replace(/```json\s*\{[\s\S]*?\}\s*```/g, '');
    d.innerHTML = esc(clean).replace(/\n/g, '<br>');
    if (edits && edits.length) {
      const wrap = document.createElement('div');
      wrap.className = 'msg-apply';
      edits.forEach((ed, i) => {
        const b = document.createElement('button');
        b.className = 'btn-sm btn-ok';
        b.style.margin = '2px 4px 2px 0';
        const el = RS.getEl(ed.id);
        b.textContent = '应用 #' + (i + 1) + (el ? '：' + (el.text || '').slice(0, 12) + '…' : '');
        b.onclick = () => {
          RS.ai.applyChatEdits([ed]);
          b.disabled = true;
          b.style.opacity = '.5';
        };
        wrap.appendChild(b);
      });
      d.appendChild(wrap);
    }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- 工具条状态 ---------- */
  function updateUndoRedo() {
    const u = document.getElementById('btnUndo');
    const r = document.getElementById('btnRedo');
    if (u) u.disabled = !RS.canUndo();
    if (r) r.disabled = !RS.canRedo();
  }
  function updateZoomLabel() {
    const l = document.getElementById('zoomLabel');
    if (l) l.textContent = Math.round(RS.state.zoom * 100) + '%';
  }

  RS.ui = {
    toast,
    showLoading,
    hideLoading,
    openModal,
    confirmModal,
    switchTab,
    renderStylePane,
    renderPagePane,
    renderSettingsPane,
    renderAiPane,
    renderJdResult,
    renderAtsResult,
    showPolishModal,
    chooseImageFor,
    updateUndoRedo,
    updateZoomLabel,
    esc,
  };
  // 别名：state.restore 通过 ui 关闭浮动工具条
  RS.ui.hideFloatBar = function () { if (RS.editor) RS.editor.hideFloatBar(); };
})();
