import asyncio

import fakeredis.aioredis
from fastapi.testclient import TestClient

import observer.main as main_mod
from observer.main import app


async def _idle(*args, **kwargs):
    await asyncio.sleep(3600)


def _mute_producers(monkeypatch):
    # WS tests exercise the hub/WS contract; producers are covered by their own tests.
    for name in ("run_redis_tap", "run_docker_events", "run_docker_poll", "run_redis_stats", "run_nginx_log"):
        monkeypatch.setattr(main_mod, name, _idle)


def test_ws_sends_snapshot_then_history(monkeypatch):
    # Route the whole app lifespan at one shared fake redis.
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(main_mod, "_make_redis", lambda: fake)
    _mute_producers(monkeypatch)

    with TestClient(app) as client:
        # Seed one event through the app's own bus, on the app's event loop.
        client.portal.call(
            lambda: app.state.bus.emit(
                type="docker.event", service="docker",
                payload={"action": "start", "container": "chorus-api-1", "service": "api"},
            )
        )
        with client.websocket_connect("/observer/ws") as ws:
            first = ws.receive_json()
            assert first["type"] == "snapshot"
            assert "containers" in first["state"]

            second = ws.receive_json()
            assert second["type"] == "batch"
            types = [e["type"] for e in second["events"]]
            assert "docker.event" in types


def test_ws_resume_from_replays_only_missed_events(monkeypatch):
    # Route the whole app lifespan at one shared fake redis.
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(main_mod, "_make_redis", lambda: fake)
    _mute_producers(monkeypatch)

    with TestClient(app) as client:
        # Seed two events through the app's own bus, on the app's event loop.
        client.portal.call(
            lambda: app.state.bus.emit(
                type="docker.event", service="docker",
                payload={"action": "start", "container": "m-A"},
            )
        )
        client.portal.call(
            lambda: app.state.bus.emit(
                type="docker.event", service="docker",
                payload={"action": "start", "container": "m-B"},
            )
        )

        history = client.portal.call(lambda: app.state.bus.history(10))
        cursor = history[0].id  # the id of the "m-A" event

        with client.websocket_connect(f"/observer/ws?resume_from={cursor}") as ws:
            first = ws.receive_json()
            assert first["type"] == "snapshot"

            second = ws.receive_json()
            assert second["type"] == "batch"
            containers = [e["payload"]["container"] for e in second["events"]]
            assert "m-B" in containers
            assert "m-A" not in containers
