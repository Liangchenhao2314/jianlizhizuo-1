# 智简简历 · AI Resume Studio

一个**联网简历制作网页**：上传 PDF / Word 简历后**100% 原样还原**，简历上的一切（文字、图片、分割线、字体、字号、颜色、位置、尺寸）都可以继续修改和移动；把目标岗位 JD 贴进来，AI 会按 JD 逐条改写简历内容，细节再手动微调——全部在一个网页里完成。

界面参考 [gracexygu.github.io/resume-formatter](https://gracexygu.github.io/resume-formatter/) 的交互理念（画布式直接编辑 + 属性面板），并扩展为支持任意 PDF/Word 简历导入与 AI 优化。

## ✨ 功能一览

### 导入（原样还原，一处不改）
- **PDF**：白盒还原——pdf.js 渲染原始页面位图做背景 + 按 PDF 内部坐标提取每一个文字/图片生成可编辑透明层。导入后与原版 **100% 一致**，且每个元素都可选中、拖动、缩放、双击改内容。
- **Word (.docx / .doc)**：
  - 服务器装有 LibreOffice（如 Railway 部署）→ 服务端精确转 PDF，走与 PDF 相同的白盒还原通道；
  - 无 LibreOffice 时浏览器端自研 **Word XML 解析器**：直接读取 `document.xml`，支持 **文本框（wps:txbx）**、普通段落、表格、图片、组合形状，按 Word 内部 EMU 坐标精确重建（常见简历都是文本框排版，此通道保证可还原）；另有 docx-preview 兜底。
- Markdown 新建、内置模板（经典黑体 / 简约现代 / 学术）、空白简历、项目 JSON 导入、自动保存与恢复。

### 编辑（所见即所得）
- 点击选中（Shift 多选）、拖动、8 手柄缩放（角点等比、文字同步缩放字号）
- 双击文字直接行内编辑；浮动格式条（加粗 / 斜体 / 下划线 / 字号 / 颜色 / 对齐 / 复制 / 删除 / 层级）
- 右侧属性面板：字体、字号、行高、字间距、对齐、颜色、背景色、位置、大小、旋转、透明度、层级、锁定
- 分割线、形状、8 类新增板块（文本 / 标题 / 图片 / 分割线 / 教育 / 工作 / 项目 / 技能）
- 页面管理：增 / 删 / 排序 / 尺寸（A4、A5、Letter、自定义）
- 撤销 / 重做（Ctrl+Z / Ctrl+Y）、复制（Ctrl+D）、Delete 删除、方向键微调、滚轮缩放
- 被编辑过的元素会在原位置自动生成白底遮罩，保证底下原版内容不出错（编辑即覆盖，视觉始终干净）

### AI 优化（按 JD 改写简历）
- 支持 **豆包（火山方舟）**、**DeepSeek**、**千问（通义 DashScope）**、**OpenAI 兼容** 四类服务商，浏览器直连或服务端代理两种模式
- **岗位定向优化**：粘贴 / 上传目标岗位 JD → AI 输出结构化建议：
  - 匹配度分析与 ATS 关键词命中率
  - 逐条“简历原文 → 改写后文 → 可一键应用”
  - 建议新增（可插入）、建议删除、差距提示
- **ATS 匹配度分析**：按 JD 关键词给出分维度打分
- **选中内容润色**：专业 / 简洁 / 口语 / 英文 / 反问 五种语气
- **AI 对话**：可携带当前简历上下文，AI 返回 JSON 修改建议，一键应用
- API Key 存浏览器 localStorage 或服务端 .env（访客无需填 Key）

### 导出
- PDF（浏览器打印矢量另存）、整页长图 PNG、逐页 PNG
- Word (.doc，绝对定位兼容)、Markdown、复制 Markdown
- 项目 JSON（可再次导入继续编辑）

## 🚀 快速开始（本地运行）

```bash
npm install
node server.js
# 打开 http://localhost:3000
```

无任何构建步骤；前端为原生 JS，三方库已本地化（pdf.js / html2canvas / jszip / docx-preview / marked），离线可用。

## 🤖 AI 接入配置（含免费方案）

**完全免费（无需充值）：**
- **智谱 GLM**：在 [open.bigmodel.cn](https://open.bigmodel.cn) 注册 → 控制台创建 API Key，模型选 `glm-4-flash`（官方免费模型，不限量）。设置页选「智谱 GLM（免费）」即可。
- **硅基流动**：在 [api.siliconflow.cn](https://api.siliconflow.cn) 注册 → 创建 API Key，模型 `Qwen/Qwen2.5-7B-Instruct`（免费模型限速但永久免费）。

**有免费额度的付费服务商：**
- **豆包（火山方舟）**：新用户注册送免费试用 tokens；控制台创建推理接入点后填 Key。
- **DeepSeek**：API 新用户常有活动赠送额度（网页版聊天免费，但不能当 API 用）。
- **千问（通义）**：DashScope 新用户送免费 token 额度，`qwen-turbo` 更便宜。

**两种接入方式，任选其一：**

1. **浏览器直连（访客填 Key）**：网页右侧「设置」→ 选择服务商 → 填 API Key。Key 仅存本机浏览器。
2. **服务端代理（访客免填 Key）**：复制 `.env.example` 为 `.env`，填入对应服务商 Key：

```env
# 免费：智谱 GLM
ZHIPU_API_KEY=你的智谱Key
ZHIPU_MODEL=glm-4-flash
# 免费：硅基流动
SILICONFLOW_API_KEY=你的硅基流动Key
SILICONFLOW_MODEL=Qwen/Qwen2.5-7B-Instruct
# 有免费额度
DOUBAO_API_KEY=你的火山方舟Key
DEEPSEEK_API_KEY=你的DeepSeekKey
QWEN_API_KEY=你的通义Key
OPENAI_API_KEY=你的OpenAIKey
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

然后网页「设置」里勾选「服务端代理模式」。站点访客无需任何配置即可使用 AI 优化。若模型不支持 JSON 模式，系统会自动降级重试（无需手动改）。

> 预设模型：豆包 `doubao-1-5-pro-32k-250115`、DeepSeek `deepseek-chat`、千问 `qwen-plus`、OpenAI `gpt-4o-mini`（均可改）。

## ☁️ 部署（Railway）

仓库已包含 `Dockerfile`（node 22 + LibreOffice + 中文字体），一键部署：

1. 推送到 GitHub 仓库（本仓库名 `jianlizhizuo-1`）
2. Railway → New Project → Deploy from GitHub repo → 选择本仓库
3. 服务启动后，在 Railway 变量中填入 `DOUBAO_API_KEY` / `DEEPSEEK_API_KEY` / `QWEN_API_KEY` 等（对应 .env 同名变量）
4. 部署完成后会得到 `*.up.railway.app` 访问地址；Docker 镜像内置 LibreOffice，Word 简历走服务端精确转换通道

## 🏗 技术架构

```
Node + Express（静态托管 / /api/convert docx→pdf / /api/ai 服务端代理）
public/
  index.html          单页应用入口
  css/style.css
  js/
    state.js          状态 / 增删改 / 撤销重做 / 自动保存
    templates.js      模板与 Markdown 排版引擎
    importers.js      PDF 白盒还原 / Word XML 解析 / docx-preview 兜底 / 项目导入
    render.js         页面渲染 / 白底遮罩 / 缩放
    editor.js         选中 / 拖动 / 缩放 / 行内编辑 / 浮动条 / 键盘
    exporters.js      PDF / PNG / Word / Markdown / 结构提取
    ai.js             四服务商 / JD 优化 / ATS / 润色 / 对话
    ui.js             面板 / 弹窗 / toast
  vendor/             本地化三方库（禁 CDN）
Dockerfile            Railway 部署（含 LibreOffice + 中文字体）
.env.example         服务端 AI Key 配置位
```

## 📝 说明

- PDF 导入的“100% 还原”以原 PDF 的渲染结果为准（像素级一致），可编辑层在此基础上叠加；Word 导入以 Word 内部排版几何为准（文本框/段落/图片坐标全部来自 docx 原生数据）。
- 浏览器直连 AI 时，Key 只存在用户自己的浏览器；服务端代理模式下 Key 存服务器，适合开放给访客使用。
- 自动保存每 30 秒写入浏览器 localStorage，刷新后可一键恢复。
