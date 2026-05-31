"""Shared test fixtures + a fake WebSocket.

These tests are offline: no Postgres, no Redis, no real network. They exercise
the pure connection/fanout logic and the wire schemas. The integration path
(real cross-node fanout) is covered by ``scripts/ws_smoke.py`` against a running
Compose stack — see the chat README.
"""

import pytest


class FakeWebSocket:
    """Duck-typed stand-in for starlette's WebSocket.

    ``ConnectionManager`` only ever calls ``send_json``; that's all we implement.
    ``fail`` makes the next send raise, to exercise dead-socket pruning.
    """

    def __init__(self, *, fail: bool = False) -> None:
        self.sent: list[dict] = []
        self.fail = fail

    async def send_json(self, payload: dict) -> None:
        if self.fail:
            raise RuntimeError("socket is dead")
        self.sent.append(payload)


@pytest.fixture
def ws_factory():
    def _make(*, fail: bool = False) -> FakeWebSocket:
        return FakeWebSocket(fail=fail)

    return _make
