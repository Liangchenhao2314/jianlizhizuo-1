/* ============================================================
 * templates.js —— 模板定义、Markdown 排版引擎、板块模板
 * 参考「简历排版器」的排版思路：黑体标题、分隔线、紧凑正文
 * ============================================================ */
window.RS = window.RS || {};

(function () {
  'use strict';
  const RS = window.RS;

  /* ---------- 模板定义 ---------- */
  const TEMPLATES = {
    classic: {
      name: '经典黑体',
      desc: '参考「简历排版器」风格：黑体大标题、分隔线、紧凑正文',
      margins: { l: 20, t: 18, r: 20, b: 16 },
      name: { font: 'SimHei', size: 20, bold: true, color: '#000000', align: 'center' },
      contact: { font: 'SimSun', size: 9.5, color: '#444444', align: 'center' },
      section: { font: 'SimHei', size: 12.5, bold: true, color: '#000000', align: 'left', divider: true, dividerColor: '#000000', spaceBefore: 14, spaceAfter: 3 },
      body: { font: 'SimSun', size: 10, lineHeight: 1.5, color: '#222222', align: 'left' },
      bullet: '●',
    },
    modern: {
      name: '简约现代',
      desc: '微软雅黑 + 蓝色标题，适合互联网 / 产品 / 运营岗位',
      margins: { l: 18, t: 16, r: 18, b: 14 },
      name: { font: 'Microsoft YaHei', size: 21, bold: true, color: '#1f2937', align: 'left' },
      contact: { font: 'Microsoft YaHei', size: 9, color: '#6b7280', align: 'left' },
      section: { font: 'Microsoft YaHei', size: 12, bold: true, color: '#2563eb', align: 'left', divider: true, dividerColor: '#2563eb', spaceBefore: 13, spaceAfter: 3 },
      body: { font: 'Microsoft YaHei', size: 9.5, lineHeight: 1.55, color: '#374151', align: 'left' },
      bullet: '▪',
    },
    academic: {
      name: '学术简历',
      desc: 'Times New Roman + 宋体，适合科研 / 教育 / 公务员',
      margins: { l: 22, t: 18, r: 22, b: 16 },
      name: { font: 'Times New Roman', size: 19, bold: true, color: '#000000', align: 'center' },
      contact: { font: 'SimSun', size: 9.5, color: '#333333', align: 'center' },
      section: { font: 'Times New Roman', size: 12.5, bold: true, color: '#000000', align: 'left', divider: true, dividerColor: '#999999', spaceBefore: 14, spaceAfter: 3 },
      body: { font: 'SimSun', size: 10, lineHeight: 1.55, color: '#222222', align: 'left' },
      bullet: '○',
    },
  };

  /* ---------- 板块模板 ---------- */
  const SECTIONS = {
    '个人信息': {
      header: '个人信息',
      rows: [
        ['姓名 / 求职意向', '求职意向：目标岗位｜现居城市'],
        ['联系方式', '电话：138-0000-0000｜邮箱：example@email.com'],
        ['其他', '性别 / 出生年月 / 到岗时间'],
      ],
    },
    '教育背景': {
      header: '教育背景',
      rows: [
        ['学校 · 专业', '学校名称｜专业名称｜学历'],
        ['时间 / 成绩', '20XX.09 – 20XX.06｜GPA 3.8/4.0'],
        ['主修课程', '课程一、课程二、课程三'],
      ],
    },
    '实习经历': {
      header: '实习经历',
      rows: [
        ['公司 · 岗位', '公司名称｜岗位名称（实习生）'],
        ['时间', '20XX.XX – 20XX.XX'],
        ['工作内容', '负责……，通过……实现……，使……提升……'],
      ],
    },
    '项目经历': {
      header: '项目经历',
      rows: [
        ['项目名称', '项目名称｜担任角色（独立 / 协作项目）'],
        ['时间', '20XX.XX – 20XX.XX'],
        ['项目内容', '项目背景与目标……；我的职责……；成果……'],
      ],
    },
    '技能特长': {
      header: '技能特长',
      rows: [
        ['专业技能', '技能一、技能二、技能三'],
        ['工具', '工具一、工具二'],
        ['语言', '英语 CET-6，听说读写能力……'],
      ],
    },
    '自我评价': {
      header: '自我评价',
      rows: [
        ['自我评价', '一句话概括：你的核心优势、行业热情与关键能力。'],
      ],
    },
    '证书荣誉': {
      header: '证书荣誉',
      rows: [
        ['荣誉奖项', '奖项一｜奖项二'],
        ['证书', '证书一｜证书二'],
      ],
    },
  };

  /* ---------- Markdown 排版引擎 ---------- */
  function pt2mm(pt) { return pt * 25.4 / 72; }

  function layoutMarkdown(md, templateKey) {
    const tpl = TEMPLATES[templateKey] || TEMPLATES.classic;
    const tokens = marked.lexer(md || '');
    const pageW = 210, pageH = 297;
    const m = tpl.margins;
    const availW = pageW - m.l - m.r;
    const pages = [];
    let page = newPage();
    let y = m.t;

    function newPage() {
      const p = { id: RS.uid('p'), w: pageW, h: pageH, elements: [], ghosts: [], noCanvas: true };
      pages.push(p);
      return p;
    }
    function ensureSpace(need) {
      if (y + need > pageH - m.b) { page = newPage(); y = m.t; }
    }
    function addText(text, style, extra) {
      if (!text || !text.trim()) return;
      const lines = String(text).split('\n');
      const lineH = pt2mm(style.size) * (style.lineHeight || 1.3);
      const need = lineH * lines.length + (extra || 0);
      ensureSpace(need);
      const el = {
        type: 'text', text: lines.join('\n'),
        x: m.l, y: y, w: availW,
        h: lineH * lines.length,
        fontFamily: style.font, fontSizePt: style.size,
        bold: !!style.bold, italic: !!style.italic,
        color: style.color || '#000',
        align: style.align || 'left',
        lineHeight: style.lineHeight || 1.3,
        letterSpacingPt: style.letterSpacing || 0,
      };
      page.elements.push(el);
      y += need;
      return el;
    }
    function addDivider(color) {
      ensureSpace(1.4);
      page.elements.push({ type: 'divider', x: m.l, y: y, w: availW, h: 0.8, color: color || '#000', thickness: 0.7 });
      y += 2.2;
    }

    for (const tok of tokens) {
      if (!tok || tok.type === 'space') continue;
      if (tok.type === 'heading') {
        if (tok.depth === 1) {
          addText(tok.text, tpl.name);
          y += 1.5;
        } else {
          y += pt2mm(tpl.section.spaceBefore || 10);
          const el = addText(tok.text, tpl.section);
          if (el && tpl.section.divider) addDivider(tpl.section.dividerColor);
          y += pt2mm(tpl.section.spaceAfter || 2);
        }
      } else if (tok.type === 'paragraph' || tok.type === 'text') {
        addText(tok.text, tpl.body);
        y += 1.2;
      } else if (tok.type === 'list') {
        for (const item of tok.items) {
          const txt = (item.text || '').replace(/<[^>]+>/g, '');
          addText((tpl.bullet ? tpl.bullet + '  ' : '') + txt, tpl.body);
          y += 0.8;
        }
      } else if (tok.type === 'code') {
        addText(tok.text, Object.assign({}, tpl.body, { font: 'Consolas', size: 8.5 }));
        y += 1;
      } else if (tok.type === 'hr') {
        addDivider(tpl.section.dividerColor);
      }
    }
    if (!pages[0].elements.length) pages[0].elements.push({ type: 'text', text: '姓名', x: m.l, y: m.t, w: availW, h: 8, fontFamily: tpl.name.font, fontSizePt: tpl.name.size, bold: true, color: '#000', align: tpl.name.align, lineHeight: 1.2 });
    return { pages, pageW, pageH, template: templateKey };
  }

  /* ---------- 插入板块（参考「新增板块」） ---------- */
  function insertSection(key) {
    const tpl = TEMPLATES[RS.state.template || 'classic'] || TEMPLATES.classic;
    const sec = SECTIONS[key];
    if (!sec) return;
    const lastPage = RS.state.pages[RS.state.pages.length - 1];
    if (!lastPage) return;
    const pageW = lastPage.w || 210, pageH = lastPage.h || 297;
    const m = tpl.margins;
    const availW = pageW - m.l - m.r;
    // 从当前页最后一个元素底部开始排版
    let y = m.t;
    if (lastPage.elements.length) {
      const maxBottom = Math.max.apply(null, lastPage.elements.map(e => e.y + e.h));
      y = Math.max(m.t, maxBottom + pt2mm(10));
    }
    let curPage = lastPage;
    const addToCurrent = (el) => { el.page = curPage.id; curPage.elements.push(el); };
    const push = (text, style, extra) => {
      const lines = String(text).split('\n');
      const lineH = pt2mm(style.size) * (style.lineHeight || 1.3);
      const need = lineH * lines.length + (extra || 0);
      if (y + need > pageH - m.b) {
        curPage = { id: RS.uid('p'), w: pageW, h: pageH, elements: [], ghosts: [], noCanvas: !!lastPage.noCanvas };
        RS.state.pages.push(curPage);
        y = m.t;
      }
      addToCurrent({ type: 'text', text: lines.join('\n'), x: m.l, y: y, w: availW, h: lineH * lines.length, fontFamily: style.font, fontSizePt: style.size, bold: !!style.bold, color: style.color || '#000', align: style.align || 'left', lineHeight: style.lineHeight || 1.3, letterSpacingPt: style.letterSpacing || 0 });
      y += need;
    };
    push(sec.header, tpl.section);
    if (tpl.section.divider) {
      if (y + 2.2 > pageH - m.b) {
        curPage = { id: RS.uid('p'), w: pageW, h: pageH, elements: [], ghosts: [], noCanvas: !!lastPage.noCanvas };
        RS.state.pages.push(curPage);
        y = m.t;
      }
      addToCurrent({ type: 'divider', x: m.l, y: y, w: availW, h: 0.8, color: tpl.section.dividerColor, thickness: 0.7 });
      y += 2.2;
    }
    for (const row of sec.rows) {
      push('【' + row[0] + '】 ' + row[1], tpl.body);
      y += 1.2;
    }
    RS.commit();
    return { header: sec.header, page: curPage.id };
  }

  RS.templates = TEMPLATES;
  RS.sections = SECTIONS;
  RS.layoutMarkdown = layoutMarkdown;
  RS.insertSection = insertSection;
  RS.pt2mm = pt2mm;
})();
