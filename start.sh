#!/bin/bash
# PikminGPS Web — macOS 啟動腳本

set -e

# Apple Silicon：若目前正以 Rosetta(x86_64) 執行，改用原生 arm64 重新啟動自己，
# 避免 universal Python 以 x86_64 載入 arm64 套件造成架構衝突 (incompatible architecture)
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] && \
   [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
    echo "[*] 偵測到 Rosetta(x86_64) 環境，改以原生 arm64 重新啟動..."
    exec arch -arm64 /bin/bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  PikminGPS Web — macOS"
echo "============================================"
echo ""

# iOS 18.2+ 的 tunneld 需要 Python 3.13+ 才能建立 TCP tunnel。
# 優先選用明確版本的 Homebrew Python，避免誤用 macOS 內建的 Python 3.9。
PYTHON=""
PATH_PYTHON="$(command -v python3 2>/dev/null || true)"
for candidate in \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/opt/python@3.13/bin/python3.13 \
    /usr/local/bin/python3.13 \
    /usr/local/opt/python@3.13/bin/python3.13 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    "$PATH_PYTHON"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ] && \
       "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 13))' 2>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "[!] 找不到 Python 3.13 或更新版本。"
    echo "    請安裝: brew install python@3.13"
    exit 1
fi

echo "[OK] Python: $PYTHON"
$PYTHON --version
echo ""

# 偵測 venv 是否損壞或版本過舊。
if [ -d "venv" ] && \
   ! venv/bin/python -c 'import sys; raise SystemExit(sys.version_info < (3, 13))' &>/dev/null; then
    echo "[!] 偵測到損壞或低於 Python 3.13 的虛擬環境，重新建立..."
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

# ---- tunneld 通道檢查（WiFi / iOS 17+ 連線必需）----
TUNNELD_CMD="$SCRIPT_DIR/venv/bin/python -m pymobiledevice3 remote tunneld --host 127.0.0.1 --port 49151"
if curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:49151/hello 2>/dev/null | grep -q "200"; then
    echo "[OK] tunneld 通道已在執行"
else
    echo "[!] tunneld 通道未啟動（WiFi 連線與 iOS 17+ 需要它）"
    read -r -p "    是否現在啟動 tunneld？需要輸入 Mac 管理員密碼 [Y/n] " ans
    if [[ ! "$ans" =~ ^[Nn] ]]; then
        echo "[*] 啟動 tunneld（會跳出管理員密碼視窗）..."
        osascript -e "do shell script \"$TUNNELD_CMD > /tmp/pikmin_tunneld.log 2>&1 &\" with administrator privileges" 2>/dev/null
        # 首次啟動與建立 TCP tunnel 可能超過 12 秒，最多等待 30 秒。
        for i in $(seq 1 30); do
            if curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:49151/hello 2>/dev/null | grep -q "200"; then
                echo "[OK] tunneld 已啟動（log: /tmp/pikmin_tunneld.log）"
                break
            fi
            sleep 1
        done
        curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:49151/hello 2>/dev/null | grep -q "200" \
            || echo "[!] tunneld 仍未回應，請手動執行: sudo $TUNNELD_CMD"
    else
        echo "    略過。稍後可手動執行: sudo $TUNNELD_CMD"
    fi
fi
echo ""

echo "============================================"
echo "  啟動伺服器: http://localhost:9527"
echo "============================================"
echo ""

python app.py
