import asyncio

import fakeredis.aioredis
import pytest

from observer.bus import Bus
from observer.supervisor import supervise


async def test_supervisor_restarts_and_reports(monkeypatch):
    # Shrink backoff so the test is fast.
    import observer.supervisor as sup
    monkeypatch.setattr(sup, "_BACKOFF_INITIAL_S", 0.01)
    monkeypatch.setattr(sup, "_BACKOFF_CAP_S", 0.02)

    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    bus = Bus(r, stream="obs:test", maxlen=100)

    calls = 0
    ran_ok = asyncio.Event()

    async def flaky():
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError(f"boom {calls}")
        ran_ok.set()
        await asyncio.sleep(3600)          # healthy forever

    task = asyncio.create_task(supervise("flaky", flaky, bus))
    await asyncio.wait_for(ran_ok.wait(), timeout=2)
    task.cancel()

    events = await bus.history(10)
    restarts = [e for e in events if e.type == "observer.health"]
    assert len(restarts) == 2
    assert restarts[0].payload["producer"] == "flaky"
    assert restarts[0].payload["status"] == "restarting"
    assert "boom 1" in restarts[0].payload["error"]
    await r.aclose()
