#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765

cd "$SCRIPT_DIR"

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" >/tmp/gesture-air-canvas.log 2>&1 &
  SERVER_PID=$!
else
  osascript -e 'display dialog "未找到 Python 3，无法启动本地服务器。" buttons {"确定"} default button "确定" with icon stop'
  exit 1
fi

sleep 1
open "http://localhost:${PORT}/gesture-air-canvas.html"

echo "隔空画板已启动：http://localhost:${PORT}/gesture-air-canvas.html"
echo "关闭此终端窗口即可停止服务。"

trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
wait "$SERVER_PID"
