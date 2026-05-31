"""Unit tests for the local connection registry and fanout."""

import pytest

from chat.connections import Connection, ConnectionManager


def _conn(ws, user_id: int, channels: set[int]) -> Connection:
    return Connection(ws=ws, user_id=user_id, username=f"u{user_id}", channel_ids=channels)


@pytest.mark.asyncio
async def test_fanout_delivers_to_channel_members_only(ws_factory):
    mgr = ConnectionManager()
    alice_ws, bob_ws, carol_ws = ws_factory(), ws_factory(), ws_factory()

    mgr.add(_conn(alice_ws, 1, {10}))  # in channel 10
    mgr.add(_conn(bob_ws, 2, {10}))    # in channel 10
    mgr.add(_conn(carol_ws, 3, {20}))  # in channel 20 only

    payload = {"type": "message", "channel_id": 10, "body": "hi"}
    await mgr.fanout(10, payload)

    assert alice_ws.sent == [payload]
    assert bob_ws.sent == [payload]
    assert carol_ws.sent == []  # not a member of channel 10


@pytest.mark.asyncio
async def test_fanout_to_empty_channel_is_noop(ws_factory):
    mgr = ConnectionManager()
    await mgr.fanout(999, {"type": "message", "channel_id": 999})  # must not raise


@pytest.mark.asyncio
async def test_connection_in_multiple_channels_gets_each(ws_factory):
    mgr = ConnectionManager()
    ws = ws_factory()
    mgr.add(_conn(ws, 1, {10, 20}))

    await mgr.fanout(10, {"channel_id": 10, "n": 1})
    await mgr.fanout(20, {"channel_id": 20, "n": 2})

    assert [m["n"] for m in ws.sent] == [1, 2]


@pytest.mark.asyncio
async def test_remove_stops_delivery(ws_factory):
    mgr = ConnectionManager()
    ws = ws_factory()
    conn = _conn(ws, 1, {10})
    mgr.add(conn)
    mgr.remove(conn)

    await mgr.fanout(10, {"channel_id": 10})
    assert ws.sent == []


@pytest.mark.asyncio
async def test_dead_socket_is_pruned_during_fanout(ws_factory):
    mgr = ConnectionManager()
    good_ws, dead_ws = ws_factory(), ws_factory(fail=True)
    mgr.add(_conn(good_ws, 1, {10}))
    mgr.add(_conn(dead_ws, 2, {10}))

    # First fanout: the good socket gets it, the dead one raises and is dropped.
    await mgr.fanout(10, {"channel_id": 10, "n": 1})
    assert len(good_ws.sent) == 1

    # Second fanout: the dead socket is gone, so no further attempts to it.
    await mgr.fanout(10, {"channel_id": 10, "n": 2})
    assert len(good_ws.sent) == 2
