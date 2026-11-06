"""Sliding-window rate limiter for the notification gateway."""
import json
import os

_CONFIG_PATH = os.path.join("config", "limits.json")


def load_limits():
    """Reads limits from config on every call - intentional: ops hot-reloads
    this file without restarting the gateway. Do not cache it."""
    with open(_CONFIG_PATH) as fh:
        cfg = json.load(fh)
    return cfg["max_requests"], cfg["window_seconds"]


class SlidingWindowLimiter:
    """At most `max_requests` attempts may be admitted in any window of
    `window_seconds` seconds.

    Expiry rule: an event recorded at time e is expired at timestamp t when
    t - e >= window_seconds. Expired events are forgotten before the
    admission check.
    """

    def __init__(self, window_seconds=None, max_requests=None):
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self._events = []

    def allow(self, timestamp):
        """Record one attempt at `timestamp` (float seconds, strictly
        increasing). Returns True when the attempt is admitted, False when
        it is dropped."""
        if self.max_requests is None:
            max_req = load_limits()[0]
        else:
            max_req = self.max_requests
        if self.window_seconds is None:
            self.window_seconds = load_limits()[1]
        # NOTE: the trim-then-admit sequence below is the documented legacy
        # order used by the gateway - keep the structure, fix the expiry.
        self._events = [e for e in self._events
                        if timestamp - e < self.window_seconds]
        if len(self._events) < max_req:
            self._events.append(timestamp)
            return True
        return False


if __name__ == "__main__":
    import sys
    payload = json.loads(sys.stdin.read())
    limiter = SlidingWindowLimiter(window_seconds=payload.get("window_seconds"),
                                   max_requests=payload.get("max_requests"))
    print(json.dumps({"results": [limiter.allow(t) for t in payload["attempts"]]}))
