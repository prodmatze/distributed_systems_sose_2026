import asyncio

import fakeredis.aioredis
import pytest

from observer.bus import Bus
from observer.hub import Hub
from observer.state import WorldState


@pytest.fixture
async def parts():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    bus = Bus(r, stream="obs:test", maxlen=100)
    hub = Hub(bus, WorldState(), replay_count=50, coalesce_ms=20, queue_max=3)
    yield r, bus, hub
    await r.aclose()


async def test_broadcaster_feeds_registered_client(parts):
    _, bus, hub = parts
    task = asyncio.create_task(hub.run())
    client = await hub.register(resume_from=None)
    await bus.emit(type="chat.message", service="chat", payload={"body": "hi"})

    frame = None
    for _ in range(50):                      # up to ~1s for tail+coalesce
        frame = await client.drain()
        if frame:
            break
    task.cancel()
    assert frame is not None
    assert frame["type"] == "batch"
    assert frame["events"][0]["type"] == "chat.message"
    assert frame["events"][0]["id"] != ""


async def test_queue_overflow_drops_oldest_and_counts(parts):
    _, bus, hub = parts
    client = await hub.register(resume_from=None)
    for i in range(5):                       # queue_max=3 -> 2 drops
        hub._push(client, {"type": "t", "id": f"{i}-0"})
    frame = await client.drain()
    assert frame["elided"] == 2
    assert len(frame["events"]) == 3
    assert frame["events"][0]["id"] == "2-0"   # oldest two dropped


async def test_hub_folds_events_into_state(parts):
    _, bus, hub = parts
    task = asyncio.create_task(hub.run())
    await bus.emit(type="presence.online", service="chat", payload={"user_id": 5})
    for _ in range(50):
        await asyncio.sleep(0.02)
        if hub.state.snapshot()["online_users"] == [5]:
            break
    task.cancel()
    assert hub.state.snapshot()["online_users"] == [5]


async def test_poison_event_does_not_kill_broadcaster(parts, monkeypatch):
    """A folding error on one envelope must not stop later envelopes from
    reaching a registered client — the whole per-envelope body is guarded,
    not just the bus.tail() call, so the broadcaster stays alive."""
    _, bus, hub = parts
    client = await hub.register(resume_from=None)

    original_apply = hub.state.apply
    calls = {"n": 0}

    def poison_apply(env):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return original_apply(env)

    monkeypatch.setattr(hub.state, "apply", poison_apply)

    task = asyncio.create_task(hub.run())
    await bus.emit(type="chat.message", service="chat", payload={"body": "poison"})
    await bus.emit(type="chat.message", service="chat", payload={"body": "survivor"})

    frame = None
    for _ in range(50):
        frame = await client.drain()
        if frame:
            break
    task.cancel()

    assert frame is not None
    bodies = [e["payload"]["body"] for e in frame["events"]]
    assert "survivor" in bodies
    assert calls["n"] == 2
