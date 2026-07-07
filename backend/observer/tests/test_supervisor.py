import asyncio
import contextlib

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


async def test_supervisor_resets_backoff_after_healthy_run(monkeypatch):
    """crash, crash (backoff doubles) -> healthy run past _HEALTHY_RESET_S ->
    crash again: the next backoff must be back at the initial value, not
    continuing to climb."""
    import observer.supervisor as sup

    monkeypatch.setattr(sup, "_BACKOFF_INITIAL_S", 0.01)
    monkeypatch.setattr(sup, "_BACKOFF_CAP_S", 0.04)
    monkeypatch.setattr(sup, "_HEALTHY_RESET_S", 0.05)

    real_sleep = asyncio.sleep       # captured before patching — used for
    recorded: list[float] = []       # the producer's own "healthy" delay so
                                      # it never pollutes the recorded backoffs

    async def recording_sleep(delay, *args, **kwargs):
        recorded.append(delay)
        await real_sleep(delay, *args, **kwargs)

    monkeypatch.setattr(sup.asyncio, "sleep", recording_sleep)

    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    bus = Bus(r, stream="obs:test", maxlen=100)

    calls = 0
    done = asyncio.Event()

    async def flaky():
        nonlocal calls
        calls += 1
        if calls <= 2:
            raise RuntimeError(f"boom {calls}")
        if calls == 3:
            await real_sleep(0.06)   # > _HEALTHY_RESET_S: counts as healthy
            raise RuntimeError("boom 3")
        done.set()
        await real_sleep(3600)       # healthy forever — test cancels here

    task = asyncio.create_task(supervise("flaky", flaky, bus))
    await asyncio.wait_for(done.wait(), timeout=2)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert recorded == [0.01, 0.02, 0.01]   # double, double, then reset

    await r.aclose()
