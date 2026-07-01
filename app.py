"""PikminGPS Web — Flask + Socket.IO backend for macOS."""
import json
import os
import socket
import subprocess
import sys
import threading
import time

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

from device import DeviceManager, log, log_exception
from navigation import (
    fetch_osrm_route, parse_gpx, calculate_route_distance,
    format_distance, format_duration, is_daytime, generate_random_walk,
)
from route import RouteWalker

app = Flask(__name__)
app.config["SECRET_KEY"] = "pikmingps"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Global state ──
device = DeviceManager()
walker = RouteWalker()
state = {
    "lat": 25.0330,
    "lng": 121.5654,
    "connected": False,
    "favorites": [],
    "nav_route_points": [],
    "nav_waypoints": [],  # raw user-picked waypoints (for point-to-point jump)
    "nav_total_distance": 0.0,
}

FAVORITES_FILE = os.path.join(os.path.dirname(__file__), "favorites.json")
LAST_ROUTE_FILE = os.path.join(os.path.dirname(__file__), "last_route.json")


def load_favorites():
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_favorites():
    with open(FAVORITES_FILE, "w", encoding="utf-8") as f:
        json.dump(state["favorites"], f, ensure_ascii=False, indent=2)


state["favorites"] = load_favorites()


# ── Walker callbacks (run in walker thread → emit via socketio) ──

def on_walker_position(lat, lng):
    state["lat"] = lat
    state["lng"] = lng
    send_location(lat, lng)
    socketio.emit("position", {"lat": lat, "lng": lng})


def on_walker_progress(current, total):
    socketio.emit("walk_progress", {"current": current, "total": total})


def on_walker_remaining(meters, seconds):
    socketio.emit("walk_remaining", {
        "meters": meters,
        "seconds": seconds,
        "dist_text": format_distance(meters),
        "time_text": format_duration(seconds),
    })


def on_walker_finished():
    socketio.emit("walk_finished")


walker.on_position = on_walker_position
walker.on_progress = on_walker_progress
walker.on_remaining = on_walker_remaining
walker.on_finished = on_walker_finished


def send_location(lat, lng):
    """Send location to connected iOS device."""
    if device.connected:
        try:
            device.set_location(lat, lng)
        except Exception as e:
            log_exception("send_location failed")
            device.connected = False
            state["connected"] = False
            socketio.emit("device_disconnected", {"error": str(e)})


# ── Routes ──

@app.route("/")
def index():
    return render_template("index.html")


TUNNELD_PORT = 49151  # pymobiledevice3 tunneld REST API default


def _tunneld_running():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        s.connect(("127.0.0.1", TUNNELD_PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


@app.route("/api/tunneld_status")
def tunneld_status():
    return jsonify({"running": _tunneld_running()})


@app.route("/api/start_tunneld", methods=["POST"])
def start_tunneld():
    if not getattr(sys, "frozen", False):
        return jsonify({
            "ok": False,
            "error": "此功能僅在 PikminGPS.app 中可用。開發模式請手動執行: sudo python3 -m pymobiledevice3 remote tunneld"
        }), 400

    if _tunneld_running():
        return jsonify({"ok": True, "already_running": True})

    exe = sys.executable.replace('"', '\\"')
    log_path = "/tmp/pikmin_tunneld.log"
    shell_cmd = f'nohup "{exe}" --tunneld > {log_path} 2>&1 &'
    osa = (
        f'do shell script "{shell_cmd}" '
        f'with administrator privileges '
        f'with prompt "PikminGPS 需要管理員權限以啟動 iOS 17+ 連線通道 (tunneld)。"'
    )
    try:
        subprocess.Popen(["osascript", "-e", osa])
    except Exception as e:
        log_exception("start_tunneld osascript failed")
        return jsonify({"ok": False, "error": str(e)}), 500

    # Wait up to 8s for the port to come up.
    for _ in range(40):
        time.sleep(0.2)
        if _tunneld_running():
            return jsonify({"ok": True, "already_running": False})
    return jsonify({
        "ok": False,
        "error": "tunneld 啟動超時 (8s)。可能是密碼輸入逾時或被取消，請再試一次。"
    }), 504


@app.route("/api/state")
def get_state():
    return jsonify({
        "lat": state["lat"],
        "lng": state["lng"],
        "connected": device.connected,
        "favorites": state["favorites"],
        "is_day": is_daytime(state["lat"], state["lng"]),
    })


# ── Socket.IO events ──

@socketio.on("connect_device")
def handle_connect(data):
    conn_type = data.get("conn_type")  # "USB", "Network", None
    try:
        emit("status", {"msg": "掃描裝置中..."})
        devices = device.scan_devices()
        if not devices:
            emit("connect_error", {"error": "找不到任何 iOS 裝置。\n請確認裝置已連接且已信任此電腦。"})
            return
        emit("device_list", {"devices": devices})
    except Exception as e:
        log_exception("scan failed")
        emit("connect_error", {"error": str(e)})


@socketio.on("select_device")
def handle_select_device(data):
    udid = data.get("udid")
    conn_type = data.get("conn_type")
    try:
        emit("status", {"msg": "連線中..."})
        conn_map = {"自動": None, "WiFi": "Network", "USB": "USB"}
        ct = conn_map.get(conn_type, conn_type)
        info = device.connect(connection_type=ct, target_udid=udid)
        state["connected"] = True
        name = info.get("name", "未知")
        ios_ver = info.get("ios_version", "?")
        method = info.get("method", "?")
        emit("connected", {
            "info": info,
            "display": f"{name} | iOS {ios_ver} ({method})",
        })
        send_location(state["lat"], state["lng"])
    except Exception as e:
        log_exception("connect failed")
        emit("connect_error", {"error": str(e)})


@socketio.on("stop_simulation")
def handle_stop():
    try:
        device.stop_simulation()
        device.connected = False
        state["connected"] = False
        emit("status", {"msg": "模擬已停止 — 已恢復真實 GPS"})
        emit("disconnected")
    except Exception as e:
        emit("status", {"msg": f"停止模擬時發生錯誤: {e}"})


@socketio.on("teleport")
def handle_teleport(data):
    lat = data["lat"]
    lng = data["lng"]
    state["lat"] = lat
    state["lng"] = lng
    send_location(lat, lng)
    emit("position", {"lat": lat, "lng": lng})
    emit("status", {"msg": f"已傳送到 {lat:.6f}, {lng:.6f}"})


@socketio.on("joystick_move")
def handle_joystick(data):
    dx = data["dx"]
    dy = data["dy"]
    speed = data.get("speed", 5.0)
    scale = 0.00003 * (speed / 5.0)
    state["lat"] += dy * scale
    state["lng"] += dx * scale
    send_location(state["lat"], state["lng"])
    emit("position", {"lat": state["lat"], "lng": state["lng"]})


@socketio.on("plan_nav_route")
def handle_plan_route(data):
    waypoints = data["waypoints"]
    speed = data.get("speed", 5.0)
    if len(waypoints) < 2:
        emit("nav_error", {"error": "至少需要 2 個路徑點"})
        return

    emit("status", {"msg": "查詢 OSRM 路線中..."})

    def worker():
        try:
            result = fetch_osrm_route(waypoints)
            state["nav_route_points"] = result["points"]
            state["nav_waypoints"] = [(p[0], p[1]) for p in waypoints]
            state["nav_total_distance"] = result["distance"]

            speed_ms = speed * 1000.0 / 3600.0
            eta = result["distance"] / speed_ms if speed_ms > 0 else 0

            socketio.emit("nav_route_ready", {
                "points": result["points"],
                "distance": result["distance"],
                "duration": eta,
                "dist_text": format_distance(result["distance"]),
                "time_text": format_duration(eta),
            })
        except Exception as e:
            log_exception("OSRM route failed")
            socketio.emit("nav_error", {"error": str(e)})

    threading.Thread(target=worker, daemon=True).start()


@socketio.on("import_gpx")
def handle_import_gpx(data):
    """Receive GPX file content (base64 or text) and parse it."""
    import base64
    import tempfile

    content = data.get("content", "")
    filename = data.get("filename", "route.gpx")

    try:
        # Write to temp file for parsing
        with tempfile.NamedTemporaryFile(mode="w", suffix=".gpx", delete=False, encoding="utf-8") as f:
            f.write(content)
            tmp_path = f.name

        result = parse_gpx(tmp_path)
        os.unlink(tmp_path)

        state["nav_route_points"] = result["points"]
        state["nav_waypoints"] = list(result["points"])
        state["nav_total_distance"] = result["distance"]

        speed = data.get("speed", 5.0)
        speed_ms = speed * 1000.0 / 3600.0
        eta = result["distance"] / speed_ms if speed_ms > 0 else 0

        emit("nav_route_ready", {
            "points": result["points"],
            "distance": result["distance"],
            "duration": eta,
            "dist_text": format_distance(result["distance"]),
            "time_text": format_duration(eta),
            "filename": filename,
        })
    except Exception as e:
        log_exception("GPX import failed")
        emit("nav_error", {"error": str(e)})


@socketio.on("import_coords")
def handle_import_coords(data):
    """Receive pasted 'lat,lng' lines and build a route."""
    content = data.get("content", "")

    try:
        points = []
        for lineno, raw in enumerate(content.splitlines(), 1):
            line = raw.strip()
            if not line:
                continue
            parts = line.replace("\t", ",").split(",")
            if len(parts) < 2:
                raise ValueError(f"第 {lineno} 行格式錯誤: {raw}")
            lat = float(parts[0].strip())
            lng = float(parts[1].strip())
            points.append((lat, lng))

        if len(points) < 2:
            raise ValueError("至少需要 2 個座標點")

        distance = calculate_route_distance(points)
        state["nav_route_points"] = points
        state["nav_waypoints"] = list(points)
        state["nav_total_distance"] = distance

        speed = data.get("speed", 5.0)
        speed_ms = speed * 1000.0 / 3600.0
        eta = distance / speed_ms if speed_ms > 0 else 0

        emit("nav_route_ready", {
            "points": points,
            "distance": distance,
            "duration": eta,
            "dist_text": format_distance(distance),
            "time_text": format_duration(eta),
            "filename": "貼上座標",
        })
    except Exception as e:
        log_exception("Coords import failed")
        emit("nav_error", {"error": str(e)})


@socketio.on("start_walk")
def handle_start_walk(data):
    speed = data.get("speed", 5.0)
    loop = data.get("loop", False)
    jump_mode = data.get("jump_mode", False)
    jump_pre = data.get("jump_pre_delay", 2.0)
    jump_post = data.get("jump_post_delay", 4.0)

    # In point-to-point jump mode we teleport between the raw user waypoints
    # rather than the densified OSRM path, so prefer the raw waypoints for a
    # navigation route that has no explicit points supplied.
    if data.get("points"):
        points = data["points"]
    elif jump_mode and state["nav_waypoints"]:
        points = state["nav_waypoints"]
    else:
        points = state["nav_route_points"]

    if len(points) < 2:
        emit("status", {"msg": "至少需要 2 個路徑點"})
        return

    # Convert to list of tuples
    waypoints = [(p[0], p[1]) for p in points]

    # Persist a backup copy of the route so coordinates can be recovered later.
    try:
        with open(LAST_ROUTE_FILE, "w", encoding="utf-8") as f:
            json.dump([[p[0], p[1]] for p in points], f, ensure_ascii=False, indent=2)
    except Exception:
        log_exception("Failed to save last_route.json")

    walker.set_waypoints(waypoints)
    walker.set_speed(speed)
    walker.loop = loop
    walker.set_jump(jump_mode, jump_pre, jump_post)
    walker.start()
    emit("walk_started")
    if jump_mode:
        emit("status", {"msg": f"點對點跳躍已開始 ({len(waypoints)} 個點)"})
    else:
        emit("status", {"msg": "行走已開始"})


@socketio.on("random_walk")
def handle_random_walk(data):
    """隨機散步模式: generate `count` random points within `radius` metres of
    the current position and auto-walk through them. Loops when requested."""
    try:
        radius = float(data.get("radius", 300))
        count = int(data.get("count", 5))
    except (TypeError, ValueError):
        emit("status", {"msg": "隨機散步失敗: 方圓公尺 / 點數格式有誤"})
        return

    radius = max(1.0, min(radius, 50000.0))
    count = max(1, min(count, 100))

    speed = data.get("speed", 5.0)
    loop = data.get("loop", False)
    # 繞幾圈 (lap count). Mutually exclusive with loop — when auto-loop is on we
    # ignore laps and walk forever; otherwise we walk the closed lap `laps` times.
    try:
        laps = int(data.get("laps", 1))
    except (TypeError, ValueError):
        laps = 1
    laps = max(1, min(laps, 999))
    jump_mode = data.get("jump_mode", False)
    jump_pre = data.get("jump_pre_delay", 2.0)
    jump_post = data.get("jump_post_delay", 4.0)

    center_lat = state["lat"]
    center_lng = state["lng"]

    # base = [centre, p1..pk]. A single closed lap returns to the centre.
    base = generate_random_walk(center_lat, center_lng, radius, count)

    if loop:
        # Walker loops the base route forever; it returns to centre each cycle.
        walk_points = base
    else:
        # Repeat the route `laps` times and close the final lap back to centre.
        walk_points = base * laps + [base[0]]

    # The map only needs the base lap drawn; repeated laps overlap it exactly.
    distance = calculate_route_distance(base)

    state["nav_route_points"] = base
    state["nav_waypoints"] = list(base)
    state["nav_total_distance"] = distance

    # Persist a backup copy of the route, matching handle_start_walk behaviour.
    try:
        with open(LAST_ROUTE_FILE, "w", encoding="utf-8") as f:
            json.dump([[p[0], p[1]] for p in base], f, ensure_ascii=False, indent=2)
    except Exception:
        log_exception("Failed to save last_route.json")

    speed_ms = speed * 1000.0 / 3600.0
    eta = distance / speed_ms if speed_ms > 0 else 0

    emit("random_walk_ready", {
        "points": base,
        "distance": distance,
        "duration": eta,
        "dist_text": format_distance(distance),
        "time_text": format_duration(eta),
        "count": len(base) - 1,
        "radius": radius,
    })

    walker.set_waypoints([(p[0], p[1]) for p in walk_points])
    walker.set_speed(speed)
    walker.loop = loop
    walker.set_jump(jump_mode, jump_pre, jump_post)
    walker.start()
    emit("walk_started")
    mode_text = "（自動循環）" if loop else f"（繞 {laps} 圈）"
    emit("status", {"msg": f"隨機散步已開始：方圓 {radius:.0f} 公尺內 {len(base) - 1} 個點{mode_text}"})


@socketio.on("stop_walk")
def handle_stop_walk():
    walker.stop()
    emit("walk_stopped")
    emit("status", {"msg": "行走已停止"})


@socketio.on("update_speed")
def handle_update_speed(data):
    speed = data.get("speed", 5.0)
    walker.set_speed(speed)
    # Recalculate ETA
    if state["nav_total_distance"] > 0:
        speed_ms = speed * 1000.0 / 3600.0
        eta = state["nav_total_distance"] / speed_ms if speed_ms > 0 else 0
        emit("nav_eta_update", {
            "dist_text": format_distance(state["nav_total_distance"]),
            "time_text": format_duration(eta),
        })


@socketio.on("save_favorite")
def handle_save_fav(data):
    name = data.get("name", "").strip()
    if not name:
        return
    category = data.get("category", "").strip() or "未分類"
    state["favorites"].append({
        "name": name,
        "category": category,
        "lat": state["lat"],
        "lng": state["lng"],
    })
    save_favorites()
    emit("favorites_updated", {"favorites": state["favorites"]})


@socketio.on("set_favorite_category")
def handle_set_fav_cat(data):
    idx = data.get("index", -1)
    category = (data.get("category") or "").strip() or "未分類"
    if 0 <= idx < len(state["favorites"]):
        state["favorites"][idx]["category"] = category
        save_favorites()
    emit("favorites_updated", {"favorites": state["favorites"]})


@socketio.on("delete_favorite")
def handle_del_fav(data):
    idx = data.get("index", -1)
    if 0 <= idx < len(state["favorites"]):
        state["favorites"].pop(idx)
        save_favorites()
    emit("favorites_updated", {"favorites": state["favorites"]})


@socketio.on("goto_favorite")
def handle_goto_fav(data):
    idx = data.get("index", -1)
    if 0 <= idx < len(state["favorites"]):
        fav = state["favorites"][idx]
        lat, lng = fav["lat"], fav["lng"]
        state["lat"] = lat
        state["lng"] = lng
        send_location(lat, lng)
        emit("position", {"lat": lat, "lng": lng})
        emit("status", {"msg": f"已傳送到「{fav['name']}」"})


@socketio.on("goldditto_cycle")
def handle_goldditto_cycle(data):
    """拉金盆 (Pikmin Bloom): push iPhone GPS to A, then immediately restore
    real GPS. The user manually opens the flower bud before pressing the
    button — this anchors the simulated position at A during the animation
    window, then hands off to real GPS. Map view is intentionally not moved
    so the user keeps watching their manually-flown gold-pot view.
    """
    lat = data.get("lat")
    lng = data.get("lng")
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        emit("status", {"msg": "拉金盆失敗: A 座標格式有誤"})
        return
    if not device.connected:
        emit("status", {"msg": "拉金盆失敗: 請先連接 iPhone"})
        return
    try:
        device.set_location(lat, lng)
        emit("goldditto_phase", {"phase": "teleported", "lat": lat, "lng": lng})
        emit("status", {"msg": f"已瞬移到 A ({lat:.6f}, {lng:.6f})，還原 GPS 中..."})
        device.stop_simulation()
        emit("goldditto_phase", {"phase": "restored"})
        emit("status", {"msg": "拉金盆完成 — 已還原真實 GPS"})
    except Exception as e:
        log_exception("goldditto cycle failed")
        emit("status", {"msg": f"拉金盆失敗: {e}"})


@socketio.on("check_daynight")
def handle_daynight():
    is_day = is_daytime(state["lat"], state["lng"])
    emit("daynight", {"is_day": is_day})


if __name__ == "__main__":
    print("=" * 50)
    print("  PikminGPS Web — http://localhost:9527")
    print("=" * 50)
    socketio.run(app, host="0.0.0.0", port=9527, debug=False, allow_unsafe_werkzeug=True)
