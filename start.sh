#!/bin/bash
# PikminGPS Web — macOS 啟動腳本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  PikminGPS Web — macOS"
echo "============================================"
echo ""

# Check Python 3 — 優先使用 Homebrew Python，避免 macOS / Xcode 內建受管理環境
if [ -x "/opt/homebrew/bin/python3" ]; then
    PYTHON="/opt/homebrew/bin/python3"
elif [ -x "/usr/local/bin/python3" ]; then
    PYTHON="/usr/local/bin/python3"
elif command -v python3 &>/dev/null; then
    PYTHON=$(command -v python3)
else
    echo "[!] 找不到 python3。"
    echo "    請安裝: brew install python3"
    exit 1
fi

echo "[OK] Python: $PYTHON"
$PYTHON --version
echo ""

# 偵測 venv 是否損壞（原 Python 解譯器被刪除 / 移動）
if [ -d "venv" ] && ! venv/bin/python -c '' &>/dev/null; then
    echo "[!] 偵測到損壞的虛擬環境，重新建立..."
    rm -rf venv
fi

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "[*] 建立虛擬環境..."
    $PYTHON -m venv venv
fi

source venv/bin/activate
echo "[OK] 虛擬環境已啟用"
echo ""

# Install dependencies
echo "[*] 安裝依賴套件..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo "[OK] 依賴安裝完成"
echo ""

echo "============================================"
echo "  啟動伺服器: http://localhost:9527"
echo "============================================"
echo ""
echo "提示: 連接 iPhone 前，你可能需要在另一個終端執行:"
echo "  sudo python3 -m pymobiledevice3 remote tunneld"
echo ""

python app.py
