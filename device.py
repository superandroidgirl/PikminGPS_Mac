"""iOS device communication via pymobiledevice3 — macOS version."""
import asyncio
import glob
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime

import requests

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.simulate_location import DtSimulateLocation
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.exceptions import ConnectionTerminatedError
from pymobiledevice3.tunneld.api import (
    get_tunneld_devices,
    get_tunneld_device_by_udid,
    TUNNELD_DEFAULT_ADDRESS,
)

LOG_FILE = os.path.join(os.path.dirname(__file__), "error.log")
TUNNELD_HOST, TUNNELD_PORT = TUNNELD_DEFAULT_ADDRESS

# Apple product_type → marketing name mapping
PRODUCT_TYPE_NAMES = {
    "iPhone13,1": "iPhone 12 mini",
    "iPhone13,2": "iPhone 12",
    "iPhone13,3": "iPhone 12 Pro",
    "iPhone13,4": "iPhone 12 Pro Max",
    "iPhone14,4": "iPhone 13 mini",
    "iPhone14,5": "iPhone 13",
    "iPhone14,2": "iPhone 13 Pro",
    "iPhone14,3": "iPhone 13 Pro Max",
    "iPhone14,6": "iPhone SE (3rd)",
    "iPhone14,7": "iPhone 14",
    "iPhone14,8": "iPhone 14 Plus",
    "iPhone15,2": "iPhone 14 Pro",
    "iPhone15,3": "iPhone 14 Pro Max",
    "iPhone15,4": "iPhone 15",
    "iPhone15,5": "iPhone 15 Plus",
    "iPhone16,1": "iPhone 15 Pro",
    "iPhone16,2": "iPhone 15 Pro Max",
    "iPhone17,1": "iPhone 16 Pro",
    "iPhone17,2": "iPhone 16 Pro Max",
    "iPhone17,3": "iPhone 16",
    "iPhone17,4": "iPhone 16 Plus",
    "iPhone17,5": "iPhone 16e",
}


def get_device_display_name(product_type):
    return PRODUCT_TYPE_NAMES.get(product_type, product_type)


def log(msg, level="INFO"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [{level}] {msg}\n"
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def log_exception(context):
    tb = traceback.format_exc()
    log(f"{context}\n{tb}", level="ERROR")


def is_admin():
    """Check if running as root (macOS)."""
    return os.geteuid() == 0


def is_tunneld_running():
    try:
        r = requests.get(
            f"http://{TUNNELD_HOST}:{TUNNELD_PORT}/hello", timeout=3
        )
        return r.status_code == 200
    except Exception:
        return False


def ensure_tunneld_running():
    """Start tunneld only when its health endpoint is not responding."""
    if is_tunneld_running():
        return
    log("Tunneld not running, launching...")
    start_tunneld()


def _find_python():
    """Find python3 on macOS."""
    if getattr(sys, "frozen", False):
        py = shutil.which("python3") or shutil.which("python")
        if py:
            return py
        raise RuntimeError(
            "找不到系統 Python。\n"
            "請安裝 Python 3：brew install python3\n"
            "或手動以 sudo 執行：\n"
            "  sudo python3 -m pymobiledevice3 remote tunneld"
        )
    return sys.executable


def start_tunneld():
    """Launch tunneld with sudo in a new Terminal window (macOS)."""
    python = _find_python()
    cmd = f"{python} -m pymobiledevice3 remote tunneld --host {TUNNELD_HOST} --port {TUNNELD_PORT}"
    log(f"Starting tunneld: {cmd}")

    # Open a new Terminal.app window with sudo
    apple_script = (
        f'tell application "Terminal"\n'
        f'  activate\n'
        f'  do script "sudo {cmd}"\n'
        f'end tell'
    )
    try:
        subprocess.run(["osascript", "-e", apple_script], check=True)
    except subprocess.CalledProcessError as e:
        log(f"osascript failed: {e}", level="ERROR")
        raise RuntimeError(
            "無法啟動 tunneld。\n"
            "請手動在終端執行：\n"
            f"  sudo {cmd}"
        )

    # Wait for tunneld to come up
    for _ in range(30):
        time.sleep(1)
        if is_tunneld_running():
            log("Tunneld is now running, waiting for device discovery...")
            time.sleep(5)
            log("Tunneld ready")
            return True

    raise RuntimeError(
        "Tunneld 已啟動但無回應。\n"
        "請檢查終端機視窗中的錯誤訊息。"
    )


class _AsyncThread:
    def __init__(self):
        self._loop = None
        self._thread = None

    def start(self):
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def run(self, coro, timeout=30):
        if not self._loop or not self._thread or not self._thread.is_alive():
            self.start()
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)

    def stop(self):
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=5)


_async_thread = _AsyncThread()
_async_thread.start()


class DeviceManager:
    """Manage connection to iOS device and GPS simulation."""

    def __init__(self):
        self.lockdown = None
        self.location_service = None
        self.device_info = None
        self.connected = False
        self._rsd = None
        self._dvt = None
        self._use_dvt = False
        self._connection_type = None
        self._target_udid = None

    def scan_devices(self) -> list[dict]:
        log("=== Scanning devices ===")
        ensure_tunneld_running()

        rsds = _async_thread.run(self._scan_tunneld(), timeout=90)
        devices = []
        for r in rsds:
            display_name = get_device_display_name(r.product_type)
            devices.append({
                "name": r.name or display_name,
                "ios_version": r.product_version,
                "model": display_name,
                "udid": r.udid,
            })
        log(f"Scan found {len(devices)} device(s): {devices}")
        return devices

    @staticmethod
    async def _scan_tunneld():
        seen = {}
        for attempt in range(20):
            rsds = await get_tunneld_devices()
            for r in rsds:
                key = r.udid.replace("-", "").lower()
                if key not in seen:
                    seen[key] = r
                    log(f"Scan: new device {r.product_type} ({r.udid})")
            log(f"Scan attempt {attempt + 1}: {len(rsds)} returned, {len(seen)} unique")
            if seen:
                break
            await asyncio.sleep(3)

        if not seen:
            return []

        stable = 0
        for extra in range(6):
            await asyncio.sleep(3)
            rsds = await get_tunneld_devices()
            new_found = False
            for r in rsds:
                key = r.udid.replace("-", "").lower()
                if key not in seen:
                    seen[key] = r
                    new_found = True
                    log(f"Scan: new WiFi device {r.product_type} ({r.udid})")
            if new_found:
                stable = 0
            else:
                stable += 1
                if stable >= 2:
                    break

        log(f"Scan complete: {len(seen)} unique device(s)")
        return list(seen.values())

    def connect(self, connection_type=None, target_udid=None) -> dict:
        log("=== Connection attempt started ===")
        log(f"Connection type: {connection_type}, target UDID: {target_udid}")
        self._connection_type = connection_type
        self._target_udid = target_udid

        if self.connected:
            log("Cleaning up previous connection...")
            self.disconnect()

        if connection_type == "Network":
            return self._connect_wifi(target_udid)

        return self._connect_usb(connection_type, target_udid)

    def _connect_wifi(self, target_udid=None) -> dict:
        log("WiFi mode: connecting directly via tunneld...")
        ensure_tunneld_running()

        try:
            rsd, dvt, loc_sim, info = _async_thread.run(
                self._connect_tunneld_dvt_with_info(target_udid, method="WiFi (Tunnel)"),
                timeout=60,
            )
            log(f"WiFi connection succeeded! Device: {info}")
            self._rsd = rsd
            self._dvt = dvt
            self.location_service = loc_sim
            self.device_info = info
            self._use_dvt = True
            self.connected = True
            return info
        except Exception as e:
            log_exception("WiFi tunneld connection failed")
            # WiFi 探索只認這台電腦自己的遠端配對金鑰 (remote_<UDID>.plist)，
            # 依金鑰檔存在與否給不同的排查指引。
            has_pair_record = bool(
                glob.glob(os.path.expanduser("~/.pymobiledevice3/remote_*.plist"))
            )
            if has_pair_record:
                hint = (
                    "這台電腦已有 WiFi 配對金鑰，請檢查：\n"
                    "1. iPhone 和電腦在同一個 WiFi 網路（且無 AP 隔離 / VPN）\n"
                    "2. Mac 防火牆沒有擋住連線\n"
                    "3. tunneld 正在執行中\n"
                    "4. 金鑰是否失效（tunneld log 出現 PairingError 時，"
                    "刪除 ~/.pymobiledevice3/remote_*.plist 後重新 USB 配對）\n"
                    "可執行 ./diagnose_wifi.sh 逐項檢查"
                )
            else:
                hint = (
                    "這台電腦還沒有 WiFi 配對金鑰 (~/.pymobiledevice3/remote_*.plist)，"
                    "每台電腦都要建立一次：\n"
                    "1. iPhone 解鎖並用 USB 接上\n"
                    "2. 保持 tunneld 執行 30~60 秒，等金鑰檔出現\n"
                    "3. 拔掉 USB 後即可用 WiFi 連線（金鑰無法從別台電腦複製）"
                )
            raise ConnectionError(f"WiFi 連線失敗: {e}\n{hint}")

    def _connect_usb(self, connection_type=None, target_udid=None) -> dict:
        try:
            info, lockdown = _async_thread.run(self._get_device_info(connection_type))
            log(f"Device found: {info}")
        except Exception as e:
            log_exception("Failed to find device via usbmux")
            raise ConnectionError(f"Cannot find iOS device: {e}")

        try:
            service = _async_thread.run(self._try_direct(lockdown))
            log("Direct DtSimulateLocation connection succeeded (iOS <= 16)")
            self.lockdown = lockdown
            self.location_service = service
            self.device_info = info
            self._use_dvt = False
            self.connected = True
            return info
        except Exception:
            log_exception("Direct connection failed (expected for iOS 17+)")

        ensure_tunneld_running()

        udid = target_udid or info.get("udid")
        try:
            rsd, dvt, loc_sim, rsd_info = _async_thread.run(
                self._connect_tunneld_dvt_with_info(udid, method="Tunnel+DVT"),
                timeout=60,
            )
            log("DVT LocationSimulation connection via tunneld succeeded!")
            self.lockdown = lockdown
            self._rsd = rsd
            self._dvt = dvt
            self.location_service = loc_sim
            info["method"] = "Tunnel+DVT"
            self.device_info = info
            self._use_dvt = True
            self.connected = True
            return info
        except Exception as e:
            log_exception("Tunneld DVT connection failed")
            raise ConnectionError(
                f"Tunneld 連線失敗: {e}\n"
                "請檢查終端機視窗中的 tunneld 狀態。"
            )

    @staticmethod
    async def _get_device_info(connection_type=None):
        lockdown = await create_using_usbmux(connection_type=connection_type)
        info = {
            "name": lockdown.display_name,
            "ios_version": lockdown.product_version,
            "model": lockdown.product_type,
            "udid": lockdown.udid,
            "method": connection_type or "Auto",
        }
        return info, lockdown

    @staticmethod
    async def _try_direct(lockdown):
        service = DtSimulateLocation(lockdown)
        await service.connect()
        return service

    @staticmethod
    async def _connect_tunneld_dvt_with_info(udid=None, method="Tunnel+DVT"):
        rsds = []
        for attempt in range(10):
            rsds = await get_tunneld_devices()
            log(f"Tunneld devices found: {len(rsds)} (attempt {attempt + 1})")
            if rsds:
                break
            await asyncio.sleep(2)
        if not rsds:
            raise ConnectionError("tunneld 找不到任何裝置。\n請確認裝置已連接且已信任此電腦。")

        rsd = None
        if udid:
            udid_clean = udid.replace("-", "").lower()
            for r in rsds:
                r_udid_clean = r.udid.replace("-", "").lower()
                if r_udid_clean == udid_clean or udid_clean in r_udid_clean or r_udid_clean in udid_clean:
                    rsd = r
                    log(f"Matched device UDID: {r.udid}")
                    break
            if rsd is None:
                raise ConnectionError(
                    f"找不到 UDID 為 {udid} 的裝置。\n"
                    f"目前可用: {[r.udid for r in rsds]}"
                )
        else:
            rsd = rsds[0]
            log(f"Using first available device: {rsd.udid}")

        display_name = get_device_display_name(rsd.product_type)
        info = {
            "name": rsd.name or display_name,
            "ios_version": rsd.product_version,
            "model": display_name,
            "udid": rsd.udid,
            "method": method,
        }

        log(f"Connecting DvtProvider + LocationSimulation for {rsd.udid}...")
        dvt = DvtProvider(rsd)
        await dvt.connect()
        log("DvtProvider connected")

        loc_sim = LocationSimulation(dvt)
        await loc_sim.connect()
        log("LocationSimulation connected")

        return rsd, dvt, loc_sim, info

    def _reconnect_dvt(self):
        log("Auto-reconnecting DVT channel...")
        if self._dvt:
            try:
                _async_thread.run(self._dvt.close(), timeout=5)
            except Exception:
                pass
        if self._rsd:
            try:
                _async_thread.run(self._rsd.close(), timeout=5)
            except Exception:
                pass

        udid = self._target_udid or (self.device_info.get("udid") if self.device_info else None)
        method = "WiFi (Tunnel)" if self._connection_type == "Network" else "Tunnel+DVT"

        rsd, dvt, loc_sim, info = _async_thread.run(
            self._connect_tunneld_dvt_with_info(udid, method=method), timeout=60
        )
        self._rsd = rsd
        self._dvt = dvt
        self.location_service = loc_sim
        log("Auto-reconnect succeeded")

    def set_location(self, lat: float, lng: float):
        if not self.connected or not self.location_service:
            raise RuntimeError("Device not connected")
        try:
            _async_thread.run(self.location_service.set(lat, lng))
        except ConnectionTerminatedError:
            log("Channel closed, attempting auto-reconnect...", level="WARN")
            try:
                self._reconnect_dvt()
                _async_thread.run(self.location_service.set(lat, lng))
                log("set_location succeeded after reconnect")
            except Exception:
                log_exception(f"set_location({lat}, {lng}) failed after reconnect")
                raise
        except Exception:
            log_exception(f"set_location({lat}, {lng}) failed")
            raise

    def stop_simulation(self):
        if self.location_service:
            try:
                _async_thread.run(self.location_service.clear(), timeout=5)
            except Exception:
                log_exception("Error clearing simulation")

    def disconnect(self):
        self.stop_simulation()
        if self._use_dvt and self._dvt:
            try:
                _async_thread.run(self._dvt.close())
            except Exception:
                log_exception("Error closing DVT")
        if self.location_service and not self._use_dvt:
            try:
                _async_thread.run(self.location_service.close())
            except Exception:
                log_exception("Error closing location service")
        if self._rsd:
            try:
                _async_thread.run(self._rsd.close())
            except Exception:
                log_exception("Error closing RSD")
        self.lockdown = None
        self.location_service = None
        self._rsd = None
        self._dvt = None
        self._use_dvt = False
        self.connected = False
        self.device_info = None
