"""Navigation routing (OSRM) and GPX import."""
import json
import math
import random
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from route import haversine_distance


def generate_random_walk(lat, lng, radius_m, count):
    """Build a strolling route of `count` random points within `radius_m`
    metres of (lat, lng), starting from the centre.

    Points are distributed uniformly over the disc, then ordered by a simple
    nearest-neighbour heuristic so the stroll flows smoothly instead of
    zig-zagging back and forth across the centre.
    Returns a list of (lat, lng) tuples beginning with the centre point.
    """
    meters_per_deg_lat = 111320.0
    meters_per_deg_lng = 111320.0 * math.cos(math.radians(lat))
    if abs(meters_per_deg_lng) < 1e-6:
        meters_per_deg_lng = 1e-6

    pts = []
    for _ in range(count):
        # sqrt() gives a uniform distribution over the area, not clustered at centre
        d = radius_m * math.sqrt(random.random())
        theta = random.random() * 2 * math.pi
        dlat = (d * math.cos(theta)) / meters_per_deg_lat
        dlng = (d * math.sin(theta)) / meters_per_deg_lng
        pts.append((lat + dlat, lng + dlng))

    ordered = []
    cur = (lat, lng)
    remaining = list(pts)
    while remaining:
        remaining.sort(key=lambda p: haversine_distance(cur[0], cur[1], p[0], p[1]))
        nxt = remaining.pop(0)
        ordered.append(nxt)
        cur = nxt

    return [(lat, lng)] + ordered


def fetch_osrm_route(waypoints, profile="foot"):
    coords = ";".join(f"{lng},{lat}" for lat, lng in waypoints)
    url = (
        f"https://router.project-osrm.org/route/v1/{profile}/{coords}"
        f"?overview=full&geometries=geojson&steps=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "PikminGPS/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.URLError as e:
        raise RuntimeError(f"網路連線失敗: {e.reason}") from e
    except Exception as e:
        raise RuntimeError(f"請求失敗: {e}") from e

    if data.get("code") != "Ok":
        raise RuntimeError(data.get("message", "OSRM 路線規劃失敗"))

    route = data["routes"][0]
    points = [(c[1], c[0]) for c in route["geometry"]["coordinates"]]
    return {
        "points": points,
        "distance": route["distance"],
        "duration": route["duration"],
    }


def parse_gpx(filepath):
    tree = ET.parse(filepath)
    root = tree.getroot()

    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    points = []

    for trk in root.iter(f"{ns}trk"):
        for trkseg in trk.iter(f"{ns}trkseg"):
            for trkpt in trkseg.iter(f"{ns}trkpt"):
                lat = float(trkpt.get("lat"))
                lng = float(trkpt.get("lon"))
                points.append((lat, lng))

    if not points:
        for rte in root.iter(f"{ns}rte"):
            for rtept in rte.iter(f"{ns}rtept"):
                lat = float(rtept.get("lat"))
                lng = float(rtept.get("lon"))
                points.append((lat, lng))

    if not points:
        for wpt in root.iter(f"{ns}wpt"):
            lat = float(wpt.get("lat"))
            lng = float(wpt.get("lon"))
            points.append((lat, lng))

    if not points:
        raise ValueError("GPX 檔案中找不到任何座標點")

    total_dist = calculate_route_distance(points)
    return {"points": points, "distance": total_dist}


def is_daytime(lat, lng):
    now = datetime.now(timezone.utc)
    doy = now.timetuple().tm_yday

    utc_offset = lng / 15.0
    local_hour = (now.hour + now.minute / 60.0 + utc_offset) % 24

    declination = 23.45 * math.sin(math.radians(360 / 365 * (doy - 81)))
    lat_rad = math.radians(lat)
    decl_rad = math.radians(declination)
    cos_ha = -math.tan(lat_rad) * math.tan(decl_rad)

    if cos_ha < -1:
        return True
    if cos_ha > 1:
        return False

    hour_angle = math.degrees(math.acos(cos_ha))
    sunrise = 12.0 - hour_angle / 15.0
    sunset = 12.0 + hour_angle / 15.0

    return sunrise <= local_hour <= sunset


def calculate_route_distance(points):
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_distance(
            points[i - 1][0], points[i - 1][1],
            points[i][0], points[i][1],
        )
    return total


def format_distance(meters):
    if meters >= 1000:
        return f"{meters / 1000:.2f} 公里"
    return f"{meters:.0f} 公尺"


def format_duration(seconds):
    if seconds < 60:
        return "< 1 分鐘"
    if seconds < 3600:
        m = int(seconds // 60)
        return f"{m} 分鐘"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    if m == 0:
        return f"{h} 小時"
    return f"{h} 小時 {m} 分鐘"
