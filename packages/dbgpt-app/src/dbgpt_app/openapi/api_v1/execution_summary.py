"""Observed visible steps and turn wall duration; never provider-call counts."""

import time


class TurnDuration:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.started = clock()
        self.finished = None

    def snapshot(self, *, terminal=False):
        if terminal and self.finished is None:
            self.finished = self.clock()
        end = self.finished if self.finished is not None else self.clock()
        return {"duration_ms": max(0, round((end - self.started) * 1000)),
                "duration_complete": self.finished is not None}


def summarize_execution(steps, timing=None):
    positions = {}
    unique = []
    for step in steps:
        step_id = step.get("id")
        if step_id and step_id in positions:
            unique[positions[step_id]] = step
        else:
            if step_id:
                positions[step_id] = len(unique)
            unique.append(step)
    visible = [step for step in unique
               if str(step.get("action") or "").lower() not in {"__progress__", "terminate"}]
    return {"version": 1, "recorded_steps": len(visible),
            "tool_steps": sum(bool(step.get("action")) for step in visible),
            **(timing or {})}
