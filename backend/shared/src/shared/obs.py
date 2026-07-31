"""Fire-and-forget observability emitter.

The observer is a pure consumer of signals that already exist, and it stays that
way for everything it can tap from the outside: Docker events, ``chan:*``
pub/sub, keyspace notifications, ``pg_stat_*``, the gateway access log.

A WebSocket frame is the one thing it cannot see. Nothing outside the chat
process observes an inbound message: the socket is already open, so nginx logs
nothing until it closes, and the ``chan:*`` tap only sees the message *after*
Redis has it, with no way to tell which replica published it. That leaves the
most interesting hop of the whole system invisible.

So chat announces those two facts itself, onto the observer's own stream, in the
observer's own envelope shape. The contract that keeps this safe is the same one
the observer's Bus.emit follows: **every failure is swallowed**. A dead Redis, a
serialisation error, a full stream — all of it degrades to a quieter dashboard
and never to a failed chat message.
"""

from __future__ import annotations

import json
import logging
import os
import socket
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

STREAM = "obs:events"
MAXLEN = 2000


def _replica_addr() -> str:
    """This container's IP on the compose network.

    Deliberately the IP and not the hostname: nginx records the same value as
    ``$upstream_addr`` for requests it routes here, so the dashboard can line an
    emitted event up with the replica the gateway attributed a request to,
    without a second mapping that could disagree.
    """
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return os.getenv("HOSTNAME", "unknown")


REPLICA_ADDR = _replica_addr()


async def emit(redis: Any, *, type: str, service: str, payload: dict) -> None:
    """Append one envelope to the observer's stream. Never raises."""
    try:
        body = json.dumps(
            {
                "type": type,
                "service": service,
                "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "corr": None,
                "payload": {**payload, "replica": REPLICA_ADDR},
            }
        )
        await redis.xadd(STREAM, {"data": body}, maxlen=MAXLEN, approximate=True)
    except Exception as exc:  # noqa: BLE001 — fire-and-forget by contract
        logger.debug("obs emit dropped (%s: %s)", type, exc)
