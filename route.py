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
        # Point-to-point jump mode: teleport between waypoints instead of
        # walking the interpolated path. jump_pre_delay is the wait before
        # each teleport, jump_post_delay the dwell after arriving.
        self.jump_mode = False
        self.jump_pre_delay = 2.0
        self.jump_post_delay = 4.0
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

    def set_jump(self, enabled: bool, pre_delay: float = None, post_delay: float = None):
        self.jump_mode = bool(enabled)
        if pre_delay is not None:
            self.jump_pre_delay = max(0.0, float(pre_delay))
        if post_delay is not None:
            self.jump_post_delay = max(0.0, float(post_delay))

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

    def pause(self):
        """停下走路執行緒但保留 _current_segment / _segment_progress，
        以便之後從原地續走（有別於 start() 會歸零的行為）。"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

    def resume(self):
        """從目前進度繼續走，不重設進度。"""
        if len(self.waypoints) < 2 or self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def is_running(self):
        return self._running

    def _run(self):
        if self.jump_mode:
            self._run_jump()
            return
        while self._running:
            self._step()
            time.sleep(1.0)

    def _sleep_interruptible(self, seconds: float) -> bool:
        """Sleep in short slices so a stop takes effect promptly.

        Returns True if the full delay elapsed, False if stopped midway.
        """
        end = time.time() + max(0.0, seconds)
        while self._running:
            remaining = end - time.time()
            if remaining <= 0:
                return True
            time.sleep(min(0.1, remaining))
        return False

    def _jump_remaining(self, index: int) -> float:
        """Straight-line distance from waypoint *index* through the rest."""
        remaining = 0.0
        for j in range(index, len(self.waypoints) - 1):
            p1 = self.waypoints[j]
            p2 = self.waypoints[j + 1]
            remaining += haversine_distance(p1[0], p1[1], p2[0], p2[1])
        return remaining

    def _run_jump(self):
        """Teleport sequentially through each waypoint, pausing jump_pre_delay
        seconds before each hop and jump_post_delay seconds after arriving.
        Repeats from the first point when loop is enabled.

        The current index is tracked in self._current_segment (not a local
        variable) so pause()/resume() can continue from where it left off
        instead of restarting the loop from the first point."""
        n = len(self.waypoints)
        while self._running:
            while self._current_segment < n:
                i = self._current_segment
                if not self._running:
                    return
                # Wait before teleporting to this point.
                if not self._sleep_interruptible(self.jump_pre_delay):
                    return

                lat, lng = self.waypoints[i]
                if self.on_position:
                    self.on_position(lat, lng)
                if self.on_progress:
                    self.on_progress(i, n - 1)

                remaining = self._jump_remaining(i)
                remaining_stops = (n - 1 - i)
                if self.loop:
                    remaining_stops = max(remaining_stops, 0)
                remaining_time = remaining_stops * (self.jump_pre_delay + self.jump_post_delay)
                if self.on_remaining:
                    self.on_remaining(remaining, remaining_time)

                is_last = (i == n - 1)
                if is_last and not self.loop:
                    self._current_segment += 1
                    continue
                # Dwell at this point before moving on.
                if not self._sleep_interruptible(self.jump_post_delay):
                    return
                self._current_segment += 1

            if not self.loop:
                break
            self._current_segment = 0

        self._running = False
        if self.on_finished:
            self.on_finished()

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
