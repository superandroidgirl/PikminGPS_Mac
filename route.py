"""Route planning and auto-walk logic — server-side version with callbacks."""
import math
import threading
import time


def haversine_distance(lat1, lng1, lat2, lng2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def interpolate(lat1, lng1, lat2, lng2, fraction):
    return (
        lat1 + (lat2 - lat1) * fraction,
        lng1 + (lng2 - lng1) * fraction,
    )


class RouteWalker:
    """Walk along a route at a given speed — thread-based for server use."""

    def __init__(self):
        self.waypoints = []
        self.speed_kmh = 5.0
        self.loop = False
        self._current_segment = 0
        self._segment_progress = 0.0
        self._running = False
        self._thread = None
        self._lock = threading.Lock()

        # Callbacks (set by app.py)
        self.on_position = None   # (lat, lng)
        self.on_progress = None   # (current_segment, total_segments)
        self.on_remaining = None  # (meters, seconds)
        self.on_finished = None   # ()

    def set_waypoints(self, points: list):
        self.waypoints = list(points)

    def set_speed(self, kmh: float):
        self.speed_kmh = max(0.5, min(kmh, 120.0))

    def start(self):
        if len(self.waypoints) < 2:
            return
        self.stop()
        self._current_segment = 0
        self._segment_progress = 0.0
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

    def is_running(self):
        return self._running

    def _run(self):
        while self._running:
            self._step()
            time.sleep(1.0)

    def _step(self):
        with self._lock:
            if self._current_segment >= len(self.waypoints) - 1:
                if self.loop:
                    self._current_segment = 0
                    self._segment_progress = 0.0
                else:
                    self._running = False
                    if self.on_finished:
                        self.on_finished()
                    return

            speed_ms = self.speed_kmh * 1000.0 / 3600.0
            remaining_budget = speed_ms

            while remaining_budget > 0 and self._current_segment < len(self.waypoints) - 1:
                p1 = self.waypoints[self._current_segment]
                p2 = self.waypoints[self._current_segment + 1]
                segment_dist = haversine_distance(p1[0], p1[1], p2[0], p2[1])

                if segment_dist < 0.01:
                    self._current_segment += 1
                    self._segment_progress = 0.0
                    continue

                remaining_in_seg = segment_dist * (1.0 - self._segment_progress)

                if remaining_budget >= remaining_in_seg:
                    remaining_budget -= remaining_in_seg
                    self._current_segment += 1
                    self._segment_progress = 0.0
                else:
                    self._segment_progress += remaining_budget / segment_dist
                    remaining_budget = 0

            # Determine final position
            if self._current_segment >= len(self.waypoints) - 1:
                lat, lng = self.waypoints[-1]
            else:
                p1 = self.waypoints[self._current_segment]
                p2 = self.waypoints[self._current_segment + 1]
                lat, lng = interpolate(p1[0], p1[1], p2[0], p2[1], self._segment_progress)

            if self.on_position:
                self.on_position(lat, lng)

            if self.on_progress:
                self.on_progress(self._current_segment, len(self.waypoints) - 1)

            remaining = self._calculate_remaining()
            remaining_time = remaining / speed_ms if speed_ms > 0 else 0
            if self.on_remaining:
                self.on_remaining(remaining, remaining_time)

    def _calculate_remaining(self):
        remaining = 0.0
        if self._current_segment < len(self.waypoints) - 1:
            p1 = self.waypoints[self._current_segment]
            p2 = self.waypoints[self._current_segment + 1]
            seg_dist = haversine_distance(p1[0], p1[1], p2[0], p2[1])
            remaining += seg_dist * (1.0 - self._segment_progress)
        for i in range(self._current_segment + 1, len(self.waypoints) - 1):
            p1 = self.waypoints[i]
            p2 = self.waypoints[i + 1]
            remaining += haversine_distance(p1[0], p1[1], p2[0], p2[1])
        return remaining
