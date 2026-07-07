"""World-state: folds the event stream into "what is true right now".

Events answer "what just happened"; a dashboard also needs current truth
(which containers are up, who is online, current rates) the moment it opens.
The WS handler sends ``snapshot()`` first, then history, then the live tail.

Rates are computed from envelope timestamps over a sliding 60s window (not
wall clock) so folding is deterministic and unit-testable.
"""

from collections import defaultdict, deque
from datetime import datetime

from observer.bus import Envelope

_WINDOW_S = 60.0

_EXITED_ACTIONS = {"die", "stop", "kill", "oom"}
_RUNNING_ACTIONS = {"start", "restart", "unpause"}


def _parse_ts(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()


class WorldState:
    def __init__(self) -> None:
        self._containers: dict[str, dict] = {}
        self._online: set[int] = set()
        self._replicas: int = 0
        self._last_event_id: str = "0-0"
        self._times: dict[str, deque[float]] = defaultdict(deque)
        self._newest_ts: float = 0.0

    def apply(self, env: Envelope) -> None:
        handler = getattr(self, f"_on_{env.type.replace('.', '_')}", None)
        if handler is not None:
            handler(env.payload)
        if env.id:
            self._last_event_id = env.id
        self._bump_rate(env)

    def snapshot(self) -> dict:
        return {
            "containers": self._containers,
            "online_users": sorted(self._online),
            "rates": self._rates(),
            "replicas": self._replicas,
            "last_event_id": self._last_event_id,
        }

    # ── folding handlers ────────────────────────────────────────────────

    def _on_docker_containers(self, p: dict) -> None:
        containers = {}
        for c in p.get("containers", []):
            name = c.get("name")
            if not name:
                continue
            containers[name] = {
                "service": c.get("service"),
                "state": c.get("state"),
                "health": c.get("health"),
                "status": c.get("status"),
                "stats": self._containers.get(name, {}).get("stats", {}),
            }
        self._containers = containers

    def _on_docker_event(self, p: dict) -> None:
        name, action = p.get("container"), p.get("action", "")
        if not name:
            return
        entry = self._containers.setdefault(
            name, {"service": p.get("service"), "state": None, "health": None,
                   "status": None, "stats": {}}
        )
        if action in _EXITED_ACTIONS:
            entry["state"] = "exited"
        elif action in _RUNNING_ACTIONS:
            entry["state"] = "running"
        elif action.startswith("health_status:"):
            entry["health"] = action.split(":", 1)[1].strip()

    def _on_docker_stats(self, p: dict) -> None:
        for name, stats in p.get("stats", {}).items():
            self._containers.setdefault(
                name, {"service": None, "state": None, "health": None,
                       "status": None, "stats": {}}
            )["stats"] = stats

    def _on_presence_online(self, p: dict) -> None:
        if (uid := p.get("user_id")) is not None:
            self._online.add(uid)

    def _on_presence_offline(self, p: dict) -> None:
        self._online.discard(p.get("user_id"))

    def _on_redis_stats(self, p: dict) -> None:
        if (n := p.get("numpat")) is not None:
            self._replicas = n

    # ── rates ───────────────────────────────────────────────────────────

    def _bump_rate(self, env: Envelope) -> None:
        try:
            t = _parse_ts(env.ts)
        except (ValueError, TypeError):
            return
        self._newest_ts = max(self._newest_ts, t)
        cutoff = self._newest_ts - _WINDOW_S
        q = self._times[env.type]
        if t >= cutoff:
            q.append(t)
        # Envelopes can arrive out of order (multiple producers, clock skew), so the
        # deque isn't guaranteed sorted; rebuild instead of popping from the head only.
        # Window sizes are small (rate-limited producers), so O(n) per bump is fine.
        for k, q_ in self._times.items():
            self._times[k] = deque(x for x in q_ if x >= cutoff)

    def _rates(self) -> dict[str, float]:
        return {k: len(q) / _WINDOW_S for k, q in self._times.items() if q}
