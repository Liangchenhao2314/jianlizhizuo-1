# 智简简历 · AI Resume Studio 部署镜像
# Railway 将优先使用本 Dockerfile（安装 LibreOffice 实现 Word 精确转 PDF）
FROM node:22-bookworm-slim

# LibreOffice + 中文字体（保证 docx 转 PDF 时中文不变成方块）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer \
       fonts-noto-cjk \
       fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
