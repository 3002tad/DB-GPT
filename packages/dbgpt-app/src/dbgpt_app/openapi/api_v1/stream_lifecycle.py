"""Transport liveness without extra model calls or synthetic progress."""

import time


class StreamHeartbeat:
    def __init__(self, interval=10.0, clock=time.monotonic):
        self.interval = interval
        self.clock = clock
        self.last = clock()

    def due(self):
        now = self.clock()
        if now - self.last < self.interval:
            return None
        self.last = now
        # SSE comments are ignored by clients and are never persisted as chat.
        return ": keepalive\n\n"
