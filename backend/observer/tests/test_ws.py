import fakeredis.aioredis
from fastapi.testclient import TestClient

import observer.main as main_mod
from observer.main import app


def test_ws_sends_snapshot_then_history(monkeypatch):
    # Route the whole app lifespan at one shared fake redis.
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(main_mod, "_make_redis", lambda: fake)

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
