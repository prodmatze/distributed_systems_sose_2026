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
    ws.apply(_env("redis.stats", {"chat_subscribers": 3, "numpat": 2}))
    assert ws.snapshot()["replicas"] == 3


def test_replicas_unchanged_when_chat_subscribers_missing():
    ws = WorldState()
    ws.apply(_env("redis.stats", {"chat_subscribers": 3, "numpat": 2}))
    ws.apply(_env("redis.stats", {"numpat": 2}, id="2-0"))
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


def test_rates_window_handles_out_of_order_timestamps():
    ws = WorldState()
    # t+0: baseline event.
    ws.apply(_env("chat.message", {}, id="1-0", ts="2026-07-07T18:00:00Z"))
    # t+120: far-newer event arrives second -> newest_ts jumps, cutoff becomes t+60,
    # correctly pruning the t+0 event (it's at the head, so head-pruning still works here).
    ws.apply(_env("chat.message", {}, id="2-0", ts="2026-07-07T18:02:00Z"))
    # t+90: older-but-in-window event (>= cutoff of t+60) arrives third, appended after t+120.
    ws.apply(_env("chat.message", {}, id="3-0", ts="2026-07-07T18:01:30Z"))
    # t+30: a stale, out-of-window event (< cutoff of t+60) arrives last, out of order.
    # It lands at the tail, behind the still-fresh t+120 head, so head-only pruning
    # would never evict it even though it's outside the 60s window.
    ws.apply(_env("chat.message", {}, id="4-0", ts="2026-07-07T18:00:30Z"))
    # Only t+120 and t+90 are within [cutoff=t+60, newest=t+120] => 2 events / 60s window.
    assert abs(ws.snapshot()["rates"]["chat.message"] - 2 / 60) < 1e-9


def test_containers_entry_without_name_is_skipped():
    ws = WorldState()
    ws.apply(_env("docker.containers", {"containers": [
        {"name": "chorus-chat-1", "service": "chat", "state": "running", "health": None, "status": "Up"},
        {"service": "chat", "state": "running", "health": None, "status": "Up"},
    ]}))
    snap = ws.snapshot()
    assert list(snap["containers"].keys()) == ["chorus-chat-1"]
