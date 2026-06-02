"""In-memory registry of the WebSocket connections this process owns.

Each chat-service replica is stateful only at the connection level: it knows
about the sockets connected to *it*, nothing about sockets on sibling replicas.
Cross-node delivery is Redis pub/sub's job (see ``pubsub.py``); this module is
purely the local side of the fanout.

Concurrency note: FastAPI/uvicorn runs every connection in the same event loop
thread, so the plain dicts/sets here need no locking — there is no real
parallelism, only cooperative ``await`` interleaving.
"""

import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger("chat.connections")


@dataclass(eq=False)
class Connection:
    """One connected client. ``eq=False`` so instances are identity-hashed and
    can live in a ``set`` even though the dataclass has mutable fields."""

    ws: WebSocket
    user_id: int
    username: str
    channel_ids: set[int] = field(default_factory=set)


class ConnectionManager:
    """Maps ``channel_id -> {Connection, ...}`` for locally-connected clients."""

    def __init__(self) -> None:
        self._by_channel: dict[int, set[Connection]] = {}

    def add(self, conn: Connection) -> None:
        for cid in conn.channel_ids:
            self._by_channel.setdefault(cid, set()).add(conn)

    def remove(self, conn: Connection) -> None:
        for cid in conn.channel_ids:
            subscribers = self._by_channel.get(cid)
            if subscribers is None:
                continue
            subscribers.discard(conn)
            if not subscribers:
                del self._by_channel[cid]

    async def fanout(self, channel_id: int, payload: dict) -> None:
        """Deliver one already-serialized message dict to every local socket
        subscribed to ``channel_id``. Dead sockets are dropped silently."""

        subscribers = self._by_channel.get(channel_id)
        if not subscribers:
            return
        # Copy: a failed send triggers removal, which mutates the live set.
        dead: list[Connection] = []
        for conn in list(subscribers):
            try:
                await conn.ws.send_json(payload)
            except Exception:  # noqa: BLE001 — any send failure means socket is gone
                logger.debug("drop dead socket for user %s", conn.user_id)
                dead.append(conn)
        for conn in dead:
            self.remove(conn)
