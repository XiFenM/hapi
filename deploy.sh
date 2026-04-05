#!/bin/bash
# HAPI 源码构建 + 部署脚本
# 用法: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN="$HOME/.bun/bin/bun"
EXE="$SCRIPT_DIR/cli/dist-exe/bun-linux-x64-baseline/hapi"
TARGET="/usr/local/bin/hapi"
CONTAINER="aurimo-dev"

echo "📦 构建中..."
cd "$SCRIPT_DIR"
$BUN run build:single-exe

echo “停止 Runner...”
"$TARGET" runner stop 2>/dev/null || true

echo "🛑 停止 Hub..."
systemctl stop hapi

echo "📋 部署到本机..."
cp "$EXE" "$TARGET"

echo "🚀 启动 Hub..."
systemctl start hapi

echo "🚀 启动本机 Runner..."
"$TARGET" runner start

echo "📋 部署到容器 $CONTAINER..."
docker exec "$CONTAINER" bash -c "$TARGET runner stop 2>/dev/null" || true
sleep 1
# 删除可能存在的符号链接，确保 docker cp 写入实际文件
docker exec "$CONTAINER" rm -f "$TARGET"
docker cp "$TARGET" "$CONTAINER:$TARGET"

echo "🚀 启动容器内 Runner..."
docker exec "$CONTAINER" bash -c "source /root/.bashrc && $TARGET runner start"

sleep 3
RUNNER=$(docker exec "$CONTAINER" bash -c "ps aux | grep 'hapi.cjs runner' | grep -v grep" 2>/dev/null || true)
if [ -n "$RUNNER" ]; then
    echo "✅ 部署完成"
    echo "   Hub: $(systemctl is-active hapi)"
    echo "   Runner: running"
else
    echo "⚠️  Hub 已部署，但容器内 Runner 启动失败，请手动检查"
fi
