FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# 先拷贝依赖清单以利用层缓存
COPY package.json package-lock.json* ./
COPY public ./public
COPY server.js ./
COPY test ./test
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/data

EXPOSE 3000

# 依赖安装与初始化均纳入容器启动过程（见 docker-entrypoint.sh）
ENTRYPOINT ["docker-entrypoint.sh"]
