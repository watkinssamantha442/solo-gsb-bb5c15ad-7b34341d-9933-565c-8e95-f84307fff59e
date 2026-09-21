#!/bin/sh
# 容器启动入口：安装依赖（首次启动）并初始化数据目录，然后启动服务
set -e

# 容器内工作目录为 /app；本地直接运行时回退到脚本所在目录
if [ -d /app ]; then
  cd /app
else
  cd "$(dirname "$0")"
fi

if [ ! -d node_modules ] || [ ! -d node_modules/express ]; then
  echo "[init] 安装 Node.js 依赖..."
  npm install --omit=dev --no-audit --no-fund
fi

mkdir -p "${DATA_DIR:-/app/data}"

echo "[init] 启动折页阅读顺序校样服务"
exec node server.js
