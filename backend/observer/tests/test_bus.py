import fakeredis.aioredis
import pytest

from observer.bus import Bus, Envelope


@pytest.fixture
async def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


@pytest.fixture
def bus(redis):
    return Bus(redis, stream="obs:test", maxlen=100)


async def test_emit_then_history_roundtrip(bus):
    await bus.emit(type="docker.event", service="docker", payload={"action": "die"})
    await bus.emit(type="chat.message", service="chat", payload={"body": "hi"}, corr="abc")

    events = await bus.history(10)
    assert len(events) == 2
    assert events[0].type == "docker.event"          # oldest first
    assert events[1].corr == "abc"
    assert events[1].payload == {"body": "hi"}
    assert events[0].id != "" and events[0].id < events[1].id  # stream ids attached, monotonic


async def test_tail_resumes_after_id(bus):
    await bus.emit(type="a", service="observer", payload={})
    first = (await bus.history(10))[0]
    await bus.emit(type="b", service="observer", payload={})

    got = await bus.tail(first.id, block_ms=10)
    assert [e.type for e in got] == ["b"]


async def test_tail_empty_returns_empty_list(bus):
    got = await bus.tail("$", block_ms=10)
    assert got == []


async def test_emit_never_raises(redis):
    class Exploding:
        async def xadd(self, *a, **k):
            raise ConnectionError("redis down")

    bus = Bus(Exploding(), stream="obs:test", maxlen=100)
    await bus.emit(type="x", service="observer", payload={})  # must not raise


async def test_envelope_defaults():
    e = Envelope(type="t", service="s")
    assert e.ts.endswith("Z") or "+" in e.ts   # RFC3339 timestamp present
    assert e.payload == {} and e.corr is None and e.id == ""
