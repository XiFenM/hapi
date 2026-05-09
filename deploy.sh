#!/bin/bash
# HAPI 源码构建 + 部署脚本
# 用法: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN="$HOME/.bun/bin/bun"
EXE="$SCRIPT_DIR/cli/dist-exe/bun-linux-x64-baseline/hapi"
TARGET="/usr/local/bin/hapi"

echo "📦 构建中..."
cd "$SCRIPT_DIR"
$BUN run build:single-exe

echo "🛑 停止 Runner..."
"$TARGET" runner stop 2>/dev/null || true

echo "🛑 停止 Hub..."
systemctl stop hapi

echo "📋 部署到本机..."
# rm + cp (not cp -f) to avoid "Text file busy" when an active
# `hapi claude` session still holds the old binary. Unlinking the
# dirent is safe — running processes keep their own inode.
rm -f "$TARGET"
cp "$EXE" "$TARGET"

echo "🚀 启动 Hub..."
systemctl start hapi

echo "🚀 启动本机 Runner..."
"$TARGET" runner start

echo "✅ 部署完成"
echo "   Hub: $(systemctl is-active hapi)"
