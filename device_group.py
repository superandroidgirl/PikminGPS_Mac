"""Multi-device group manager — fan out GPS simulation to up to 3 iPhones.

Ported from LocWarp's 多裝置群組模式 (multi-device group mode). Wraps several
single-device ``DeviceManager`` instances (one per connected iPhone) and mirrors
every location update to all of them, so teleport / navigation / loop /
multi-stop / random walk / joystick / gold-ditto all stay in sync across every
linked device.

A late-joining device is teleported to the current position on connect and then
receives all subsequent walker updates, so it automatically catches up to and
continues whatever task the group is already running (fanout).
"""
from device import DeviceManager, log, log_exception


class DeviceGroup:
    """Manage up to ``MAX_DEVICES`` linked iPhones and fan out GPS updates."""

    MAX_DEVICES = 3

    def __init__(self):
        self._devices = {}               # udid -> DeviceManager
        self._scanner = DeviceManager()  # dedicated instance used only for scanning

    # ── Discovery ──────────────────────────────────────────────────────
    def scan_devices(self) -> list[dict]:
        return self._scanner.scan_devices()

    # ── Membership ─────────────────────────────────────────────────────
    @property
    def connected(self) -> bool:
        return len(self._devices) > 0

    @property
    def count(self) -> int:
        return len(self._devices)

    def has(self, udid) -> bool:
        return udid in self._devices

    def list_info(self) -> list[dict]:
        """Return connection info for every linked device (for the UI)."""
        out = []
        for udid, dev in self._devices.items():
            info = dev.device_info or {}
            name = info.get("name") or "?"
            out.append({
                "udid": udid,
                "name": name,
                "ios_version": info.get("ios_version", "?"),
                "method": info.get("method", "?"),
                "model": info.get("model", ""),
                "display": f"{name} | iOS {info.get('ios_version', '?')} ({info.get('method', '?')})",
            })
        return out

    # ── Add / remove ───────────────────────────────────────────────────
    def add(self, target_udid, connection_type=None) -> dict:
        """Connect a new iPhone and link it into the group.

        Refreshes the connection if the device is already linked. Raises when
        the group is already at ``MAX_DEVICES``.
        """
        # Refresh if this device is already linked.
        if target_udid in self._devices:
            self.remove(target_udid)

        if len(self._devices) >= self.MAX_DEVICES:
            raise RuntimeError(f"最多只能同時連接 {self.MAX_DEVICES} 台 iPhone")

        dev = DeviceManager()
        info = dev.connect(connection_type=connection_type, target_udid=target_udid)
        udid = info.get("udid") or target_udid
        self._devices[udid] = dev
        log(f"DeviceGroup: added {udid} ({len(self._devices)}/{self.MAX_DEVICES})")
        return info

    def remove(self, udid):
        dev = self._devices.pop(udid, None)
        if dev is None:
            return
        try:
            dev.disconnect()
        except Exception:
            log_exception(f"DeviceGroup: error disconnecting {udid}")
        log(f"DeviceGroup: removed {udid} ({len(self._devices)}/{self.MAX_DEVICES})")

    # ── Fan-out operations ─────────────────────────────────────────────
    def set_location_all(self, lat, lng) -> list[tuple]:
        """Push (lat, lng) to every linked device.

        Returns ``[(udid, error), ...]`` for any device that failed and was
        dropped from the group, so the caller can notify the UI. Devices that
        succeed keep running.
        """
        failed = []
        for udid, dev in list(self._devices.items()):
            try:
                dev.set_location(lat, lng)
            except Exception as e:
                log_exception(f"DeviceGroup: set_location failed for {udid}")
                self._devices.pop(udid, None)
                try:
                    dev.disconnect()
                except Exception:
                    pass
                failed.append((udid, str(e)))
        return failed

    def stop_all(self):
        """Clear the simulation on every device (restore real GPS) but keep
        them linked so a following teleport re-simulates immediately."""
        for dev in self._devices.values():
            try:
                dev.stop_simulation()
            except Exception:
                log_exception("DeviceGroup: stop_simulation error")

    def disconnect_all(self):
        """Stop simulation and fully unlink every device."""
        for udid in list(self._devices.keys()):
            self.remove(udid)
