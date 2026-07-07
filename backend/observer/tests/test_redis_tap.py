import asyncio
import contextlib
import json
import time

import fakeredis.aioredis
import pytest

from observer.bus import Bus
from observer.producers.redis_tap import run_redis_tap, translate


def test_chat_message_translates():
    body = {"type": "message", "id": 7, "channel_id": 3, "sender_id": 1,
            "sender_username": "alice", "body": "hi", "created_at": "2026-07-07T18:00:00Z"}
    out = translate("chan:3", json.dumps(body), set())
    assert out == ("chat.message", "chat", {"channel_id": 3, "message": body})


def test_presence_set_new_user_goes_online():
    out = translate("__keyevent@0__:set", "presence:42", set())
    assert out == ("presence.online", "chat", {"user_id": 42})


def test_presence_set_known_user_is_silent_refresh():
    assert translate("__keyevent@0__:set", "presence:42", {42}) is None


def test_presence_expired_goes_offline():
    out = translate("__keyevent@0__:expired", "presence:42", {42})
    assert out == ("presence.offline", "chat", {"user_id": 42})


def test_presence_del_goes_offline():
    out = translate("__keyevent@0__:del", "presence:9", {9})
    assert out == ("presence.offline", "chat", {"user_id": 9})


def test_non_presence_keyevents_ignored():
    assert translate("__keyevent@0__:set", "somekey", set()) is None
    assert translate("__keyevent@0__:expired", "cache:1", set()) is None


def test_malformed_chat_payload_ignored():
    assert translate("chan:3", "not json", set()) is None
    assert translate("chan:notanint", "{}", set()) is None


# ---------------------------------------------------------------------------
# run_redis_tap: cleanup guarantees + loop integration
# ---------------------------------------------------------------------------


class _LeakSpyPubsub:
    """A pubsub stand-in whose psubscribe always fails, so we can prove the
    tap's finally block still reaches it."""

    def __init__(self, parent: "_LeakSpyRedis") -> None:
        self._parent = parent

    async def psubscribe(self, *channels):
        raise RuntimeError("boom psubscribe")

    async def aclose(self):
        self._parent.pubsub_aclose_called = True


class _LeakSpyRedis:
    """Wraps a real FakeRedis so config_set still behaves, but pubsub()
    hands back a spy whose psubscribe raises — simulating the failure mode
    from Finding 1 without needing to mock the redis client wholesale."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.redis_aclose_called = False
        self.pubsub_aclose_called = False

    def pubsub(self):
        return _LeakSpyPubsub(self)

    async def config_set(self, *args, **kwargs):
        return await self._inner.config_set(*args, **kwargs)

    async def aclose(self):
        self.redis_aclose_called = True
        await self._inner.aclose()


async def test_psubscribe_failure_still_closes_pubsub_and_redis():
    """Regression test for the connection leak: if psubscribe() raises,
    both the pubsub and the redis client must still be closed (guaranteed
    by the try/finally now wrapping their entire lifetime), otherwise the
    supervisor's retry loop leaks one client per crashed cycle."""
    inner = fakeredis.aioredis.FakeRedis(decode_responses=True)
    spy = _LeakSpyRedis(inner)
    bus = Bus(inner, stream="obs:test", maxlen=100)

    with pytest.raises(RuntimeError, match="boom psubscribe"):
        await run_redis_tap(lambda: spy, bus)

    assert spy.pubsub_aclose_called
    assert spy.redis_aclose_called

    await inner.aclose()


async def _wait_subscribed(r, *, patterns: int = 2, timeout: float = 2.0) -> None:
    """Poll PUBSUB NUMPAT until the tap's psubscribe has landed, so tests
    don't race publishing against subscription setup (a plain publish
    before the subscriber is ready is simply lost, like real Redis)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await r.pubsub_numpat() >= patterns:
            return
        await asyncio.sleep(0.02)
    raise AssertionError("tap did not subscribe in time")


async def _cancel_and_await(task: asyncio.Task) -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def test_tap_loop_delivers_chat_and_presence():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    bus = Bus(r, stream="obs:test", maxlen=100)

    task = asyncio.create_task(run_redis_tap(lambda: r, bus))
    try:
        await _wait_subscribed(r)

        body = {"type": "message", "id": 1, "channel_id": 5, "sender_id": 1,
                "sender_username": "alice", "body": "hi", "created_at": "2026-07-07T18:00:00Z"}
        await r.publish("chan:5", json.dumps(body))
        await r.publish("__keyevent@0__:set", "presence:42")
        await r.publish("__keyevent@0__:expired", "presence:42")

        events = []
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            events = await bus.history(10)
            if [e.type for e in events] == [
                "chat.message", "presence.online", "presence.offline"
            ]:
                break
            await asyncio.sleep(0.02)

        assert [e.type for e in events] == [
            "chat.message", "presence.online", "presence.offline"
        ]
        assert events[0].payload == {"channel_id": 5, "message": body}
        assert events[1].payload == {"user_id": 42}
        assert events[2].payload == {"user_id": 42}
    finally:
        await _cancel_and_await(task)


async def test_tap_loop_token_bucket_folds_flood_into_summary():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    bus = Bus(r, stream="obs:test", maxlen=200)

    task = asyncio.create_task(run_redis_tap(lambda: r, bus))
    try:
        await _wait_subscribed(r)

        body = json.dumps({"type": "message", "id": 0, "channel_id": 1, "sender_id": 1,
                            "sender_username": "flood", "body": "x",
                            "created_at": "2026-07-07T18:00:00Z"})
        for _ in range(60):
            await r.publish("chan:1", body)

        emitted, summaries = [], []
        deadline = time.monotonic() + 3.5
        while time.monotonic() < deadline:
            events = await bus.history(300)
            emitted = [e for e in events if e.type == "chat.message"]
            summaries = [e for e in events if e.type == "chat.message.summary"]
            if summaries:
                break
            await asyncio.sleep(0.05)

        assert len(emitted) <= 41, "burst cap (40) should hold, +1 slack for refill jitter"
        assert summaries, "flood overflow must fold into at least one summary event"
        assert len(emitted) + sum(s.payload["count"] for s in summaries) == 60
    finally:
        await _cancel_and_await(task)
