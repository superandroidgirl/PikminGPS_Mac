#!/bin/bash
# PikminGPS Web — WiFi 連線診斷腳本
# 逐項檢查 WiFi 模式連不到手機的常見原因，並指出卡在哪一步。
# 用法: ./diagnose_wifi.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---- 顏色 ----
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'
ok()   { echo -e "${G}[OK]${N}  $1"; }
bad()  { echo -e "${R}[!!]${N}  $1"; }
warn() { echo -e "${Y}[??]${N}  $1"; }
step() { echo -e "\n${B}=== $1 ===${N}"; }

# ---- 挑選 app 實際用的 Python（優先 venv，跟 start.sh 一致）----
if [ -x "venv/bin/python" ]; then
    PMD="venv/bin/python"
elif [ -x "/opt/homebrew/bin/python3" ]; then
    PMD="/opt/homebrew/bin/python3"
else
    PMD="$(command -v python3)"
fi

echo "============================================"
echo "  PikminGPS WiFi 連線診斷"
echo "============================================"
echo "使用 Python: $PMD"

PROBLEMS=0

# ---- 1. pymobiledevice3 是否裝在這個 Python ----
step "1. 檢查 pymobiledevice3"
if $PMD -c "import pymobiledevice3, importlib.metadata as m; print(m.version('pymobiledevice3'))" 2>/dev/null; then
    ok "pymobiledevice3 已安裝於 app 使用的環境"
else
    bad "app 用的 Python ($PMD) 沒有 pymobiledevice3 → 先跑 ./start.sh 安裝依賴"
    PROBLEMS=$((PROBLEMS+1))
fi

# ---- 2. Mac WiFi IP ----
step "2. 同網段檢查"
MAC_IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -n "$MAC_IP" ]; then
    ok "Mac WiFi (en0) IP: $MAC_IP  → 確認 iPhone 也在 ${MAC_IP%.*}.x 同一個 WiFi"
else
    warn "en0 沒有 IP，Mac 可能沒連 WiFi 或走別的介面"
fi

# ---- 3. 看得到裝置嗎 (USB / 網路) ----
step "3. 裝置是否被偵測 (usbmux)"
DEVLIST=$($PMD -m pymobiledevice3 usbmux list 2>/dev/null)
DEVCOUNT=$(echo "$DEVLIST" | $PMD -c "import sys,json;
try: print(len(json.load(sys.stdin)))
except: print(0)" 2>/dev/null)
if [ "$DEVCOUNT" -ge 1 ] 2>/dev/null; then
    ok "偵測到 $DEVCOUNT 台裝置"
    echo "$DEVLIST" | $PMD -c "import sys,json
for d in json.load(sys.stdin):
    print('     -', d.get('DeviceName','?'), '| UDID', d.get('UniqueDeviceID','?')[:12]+'...', '| 連線:', d.get('ConnectionType','?'))" 2>/dev/null
    # 是否有 Network 連線
    if echo "$DEVLIST" | grep -qi "Network"; then
        ok "其中有 WiFi(Network) 連線的裝置"
    else
        warn "目前只有 USB 連線；要拔 USB 走 WiFi，需在 Finder 勾「在 Wi-Fi 連線時顯示此 iPhone」"
    fi
else
    bad "完全偵測不到裝置 → 請先 USB 接上 iPhone、解鎖、按「信任這台電腦」"
    bad "WiFi 模式必須先用 USB 建立信任與通道後才能切 WiFi"
    PROBLEMS=$((PROBLEMS+1))
fi

# ---- 4. WiFi 遠端配對金鑰 (remote_*.plist) ----
# tunneld 的 WiFi 探索只會連「已有遠端配對金鑰」的裝置。
# 金鑰是每台電腦各自建立的，不會隨 app / 專案資料夾複製。
step "4. WiFi 遠端配對金鑰 (remote_*.plist)"
USER_KEY_DIR="$HOME/.pymobiledevice3"
ROOT_KEY_DIR="/var/root/.pymobiledevice3"
USER_KEYS=$(ls "$USER_KEY_DIR"/remote_*.plist 2>/dev/null)
ROOT_KEYS=""
if sudo -n true 2>/dev/null; then
    ROOT_KEYS=$(sudo -n ls "$ROOT_KEY_DIR"/remote_*.plist 2>/dev/null)
    ROOT_CHECKED=1
else
    ROOT_CHECKED=0
fi

if [ -n "$USER_KEYS" ]; then
    ok "使用者金鑰 ($USER_KEY_DIR):"
    for k in $USER_KEYS; do echo "     - $(basename "$k")"; done
fi
if [ -n "$ROOT_KEYS" ]; then
    ok "root 金鑰 ($ROOT_KEY_DIR):"
    for k in $ROOT_KEYS; do echo "     - $(basename "$k")"; done
fi

if [ -z "$USER_KEYS" ] && [ -z "$ROOT_KEYS" ]; then
    bad "這台電腦沒有 WiFi 配對金鑰 (remote_<UDID>.plist) ← WiFi 連不到的根本原因"
    echo "      建立方式（每台電腦做一次）："
    echo "      1. iPhone 解鎖、USB 接上"
    echo "      2. sudo $PMD -m pymobiledevice3 remote tunneld --host 127.0.0.1 --port 49151"
    echo "      3. 保持插線等 30~60 秒，直到 $USER_KEY_DIR/remote_*.plist 出現"
    echo "      4. 拔線後即可走 WiFi（金鑰不能從別台電腦複製過來）"
    if [ "$ROOT_CHECKED" -eq 0 ]; then
        warn "無法檢查 $ROOT_KEY_DIR（需要 sudo），可手動確認: sudo ls $ROOT_KEY_DIR/"
    fi
    PROBLEMS=$((PROBLEMS+1))
else
    # 金鑰位置必須和 tunneld 啟動方式一致：
    # Terminal sudo 啟動 → 讀 ~/.pymobiledevice3；app 按鈕 (osascript) 啟動 → 讀 /var/root/.pymobiledevice3
    if [ -z "$USER_KEYS" ] && [ -n "$ROOT_KEYS" ]; then
        warn "金鑰只在 $ROOT_KEY_DIR → 用 Terminal sudo 啟動的 tunneld 會讀不到"
        echo "      可複製到使用者目錄: sudo cp $ROOT_KEY_DIR/remote_*.plist $USER_KEY_DIR/"
    elif [ -n "$USER_KEYS" ] && [ "$ROOT_CHECKED" -eq 1 ] && [ -z "$ROOT_KEYS" ]; then
        warn "金鑰只在 $USER_KEY_DIR → 若用 app 按鈕啟動 tunneld（osascript）可能讀不到（新版已修正）"
    fi
    # UDID 比對：金鑰要屬於目前偵測到的手機
    if [ "$DEVCOUNT" -ge 1 ] 2>/dev/null; then
        DETECTED_UDIDS=$(echo "$DEVLIST" | $PMD -c "import sys,json
for d in json.load(sys.stdin): print(d.get('UniqueDeviceID',''))" 2>/dev/null)
        for k in $USER_KEYS $ROOT_KEYS; do
            KUDID=$(basename "$k" .plist); KUDID=${KUDID#remote_}
            if ! echo "$DETECTED_UDIDS" | grep -qi "$KUDID"; then
                warn "金鑰 $(basename "$k") 不屬於目前偵測到的手機（每支手機各需自己的金鑰）"
            fi
        done
    fi
fi

# 金鑰失效跡象：tunneld log 反覆略過配對
if [ -f /tmp/pikmin_tunneld.log ] && grep -qE "PairingError|Skipping remote pairing" /tmp/pikmin_tunneld.log 2>/dev/null; then
    warn "tunneld log 出現配對錯誤 (PairingError / Skipping remote pairing)"
    echo "      金鑰可能失效或手機已重置信任 → 刪除該 remote_*.plist 後重新 USB 配對"
fi

# ---- 5. 手機是否在網路上廣播 WiFi 配對服務 (mDNS) ----
step "5. 手機 WiFi 配對服務廣播 (mDNS)"
RP_OUT="/tmp/pikmin_rp_browse.$$"
(dns-sd -B _remotepairing._tcp local. > "$RP_OUT" 2>&1 &)
sleep 8
pkill -f "dns-sd -B _remotepairing" 2>/dev/null
if grep -q "^..:.*Add" "$RP_OUT" 2>/dev/null; then
    ok "網路上找得到手機的 WiFi 配對服務："
    grep "Add" "$RP_OUT" | awk '{print "     -", $NF}'
else
    bad "網路上找不到手機的配對服務 (_remotepairing._tcp) ← tunneld 也會找不到"
    echo "      請檢查：Mac 防火牆（系統設定>網路>防火牆，暫時關閉測試）、"
    echo "      訪客/公司 WiFi 的裝置隔離 (AP isolation)、Mac 或手機的 VPN、"
    echo "      手機是否解鎖且連上同一個 WiFi"
    PROBLEMS=$((PROBLEMS+1))
fi
rm -f "$RP_OUT"

# ---- 6. 開發者模式 ----
step "6. 開發者模式 / 解鎖狀態"
DEVMODE=$($PMD -m pymobiledevice3 lockdown info 2>/dev/null | grep -i "DeveloperMode" | head -1)
PRODVER=$($PMD -m pymobiledevice3 lockdown info 2>/dev/null | grep -i "ProductVersion" | head -1)
if [ -n "$PRODVER" ]; then
    ok "$PRODVER"
    if echo "$DEVMODE" | grep -qi "true"; then
        ok "開發者模式已開啟"
    else
        warn "開發者模式可能未開 → iPhone 設定 > 隱私權與安全性 > 開發者模式 (需重開機)"
    fi
else
    warn "拿不到 lockdown info（裝置沒接 USB、沒配對、或螢幕鎖著）"
fi

# ---- 7. tunneld 是否在跑 + 健康檢查 ----
step "7. tunneld 通道狀態 (port 49151)"
HELLO=$(curl -s --max-time 4 http://127.0.0.1:49151/hello 2>/dev/null)
if [ -n "$HELLO" ] || curl -s --max-time 4 -o /dev/null -w "%{http_code}" http://127.0.0.1:49151/hello 2>/dev/null | grep -q "200"; then
    ok "tunneld 有回應 (/hello)"
else
    bad "tunneld 沒有回應 → 在另一個終端啟動："
    echo "      sudo $PMD -m pymobiledevice3 remote tunneld --host 127.0.0.1 --port 49151"
    PROBLEMS=$((PROBLEMS+1))
fi

# ---- 8. tunneld 通道內有沒有發現手機 ----
step "8. tunneld 是否已發現你的手機"
TUN=$(curl -s --max-time 5 http://127.0.0.1:49151/ 2>/dev/null)
TUNCOUNT=$(echo "$TUN" | $PMD -c "import sys,json
try:
    d=json.load(sys.stdin); print(sum(len(v) for v in d.values()) if isinstance(d,dict) else 0)
except: print(0)" 2>/dev/null)
if [ "$TUNCOUNT" -ge 1 ] 2>/dev/null; then
    ok "tunneld 通道內已發現 $TUNCOUNT 個裝置 → WiFi 模式應該可以連了！"
else
    bad "tunneld 通道內【沒有任何裝置】← 這就是 WiFi 連不到的直接原因"
    echo "      請依序：USB接上→信任→Finder勾WiFi顯示→重啟tunneld→等5~10秒"
    PROBLEMS=$((PROBLEMS+1))
fi

# ---- 9. anaconda/系統 python 跑著舊 tunneld 的衝突提醒 ----
step "9. 環境衝突檢查"
RUNNING_TUN=$(ps aux | grep "[r]emote tunneld" | grep -v grep)
if echo "$RUNNING_TUN" | grep -q "anaconda"; then
    warn "目前的 tunneld 是用 anaconda 跑的，但 app 用的是 $PMD"
    warn "兩個環境的 pymobiledevice3 版本不同可能互打架。建議用同一個環境跑 tunneld："
    echo "      sudo pkill -f 'remote tunneld'"
    echo "      sudo $PMD -m pymobiledevice3 remote tunneld --host 127.0.0.1 --port 49151"
else
    ok "沒有偵測到 anaconda 版 tunneld 衝突"
fi

# ---- 結論 ----
echo ""
echo "============================================"
if [ "$PROBLEMS" -eq 0 ]; then
    echo -e "${G}  所有檢查通過，WiFi 模式應可正常連線。${N}"
else
    echo -e "${R}  發現 $PROBLEMS 個問題，請依上面 [!!] 標記處理。${N}"
fi
echo "============================================"
