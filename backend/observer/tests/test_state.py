from observer.bus import Envelope
from observer.state import WorldState


def _env(type: str, payload: dict, id: str = "1-0", ts: str = "2026-07-07T18:00:00Z"):
    return Envelope(id=id, type=type, service="test", ts=ts, payload=payload)


def test_containers_resync_replaces_map():
    ws = WorldState()
    ws.apply(_env("docker.containers", {"containers": [
        {"name": "chorus-chat-1", "service": "chat", "state": "running", "health": None, "status": "Up 2 minutes"},
    ]}))
    snap = ws.snapshot()
    assert snap["containers"]["chorus-chat-1"]["state"] == "running"
    assert snap["containers"]["chorus-chat-1"]["service"] == "chat"


def test_docker_event_updates_state():
    ws = WorldState()
    ws.apply(_env("docker.containers", {"containers": [
        {"name": "chorus-chat-2", "service": "chat", "state": "running", "health": None, "status": "Up"},
    ]}))
    ws.apply(_env("docker.event", {"action": "die", "container": "chorus-chat-2", "service": "chat"}, id="2-0"))
    assert ws.snapshot()["containers"]["chorus-chat-2"]["state"] == "exited"
    ws.apply(_env("docker.event", {"action": "start", "container": "chorus-chat-2", "service": "chat"}, id="3-0"))
    assert ws.snapshot()["containers"]["chorus-chat-2"]["state"] == "running"


def test_docker_event_for_unknown_container_creates_entry():
    ws = WorldState()
    ws.apply(_env("docker.event", {"action": "start", "container": "chorus-api-1", "service": "api"}))
    assert ws.snapshot()["containers"]["chorus-api-1"]["state"] == "running"


def test_stats_merge_into_containers():
    ws = WorldState()
    ws.apply(_env("docker.containers", {"containers": [
        {"name": "chorus-redis-1", "service": "redis", "state": "running", "health": "healthy", "status": "Up"},
    ]}))
    ws.apply(_env("docker.stats", {"stats": {"chorus-redis-1": {"cpu_pct": 1.5, "mem_mb": 12.0}}}, id="2-0"))
    assert ws.snapshot()["containers"]["chorus-redis-1"]["stats"]["cpu_pct"] == 1.5


def test_presence_online_offline():
    ws = WorldState()
    ws.apply(_env("presence.online", {"user_id": 7}))
    ws.apply(_env("presence.online", {"user_id": 9}, id="2-0"))
    assert sorted(ws.snapshot()["online_users"]) == [7, 9]
    ws.apply(_env("presence.offline", {"user_id": 7}, id="3-0"))
    assert ws.snapshot()["online_users"] == [9]


def test_replicas_from_redis_stats():
    ws = WorldState()
    ws.apply(_env("redis.stats", {"numpat": 3}))
    assert ws.snapshot()["replicas"] == 3


def test_rates_sliding_window():
    ws = WorldState()
    for i in range(6):
        ws.apply(_env("chat.message", {}, id=f"{i}-0", ts=f"2026-07-07T18:00:0{i}Z"))
    # 6 events across the 60s window ending at the newest ts => 0.1/s
    assert abs(ws.snapshot()["rates"]["chat.message"] - 0.1) < 1e-9


def test_last_event_id_tracks_newest():
    ws = WorldState()
    ws.apply(_env("presence.online", {"user_id": 1}, id="41-0"))
    ws.apply(_env("presence.offline", {"user_id": 1}, id="42-0"))
    assert ws.snapshot()["last_event_id"] == "42-0"
