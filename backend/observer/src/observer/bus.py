"""The event bus: one Redis Stream as bus + ring buffer + replay cursor.

``XADD MAXLEN ~ N`` gives a bounded buffer for free — nothing grows unbounded
even if no dashboard is ever opened. Readers use the stream ID as a monotonic
resume cursor, the same replay-then-tail shape as the chat service's
``last_seen_id`` reconnect protocol (docs/ARCHITECTURE.md §4.3).

``emit`` is fire-and-forget BY CONTRACT: observability must never break the
observed, so a Redis blip means dropped telemetry, never an exception in a
producer loop.
"""

import json
import logging
from datetime import datetime, timezone

from pydantic import BaseModel, Field

logger = logging.getLogger("observer.bus")


def _now_rfc3339() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Envelope(BaseModel):
    id: str = ""  # Redis stream ID; attached by readers, empty on emit
    type: str
    service: str
    ts: str = Field(default_factory=_now_rfc3339)
    corr: str | None = None
    payload: dict = Field(default_factory=dict)


class Bus:
    def __init__(self, redis, *, stream: str, maxlen: int) -> None:
        self._redis = redis
        self._stream = stream
        self._maxlen = maxlen

    async def emit(
        self, *, type: str, service: str, payload: dict, corr: str | None = None
    ) -> None:
        env = Envelope(type=type, service=service, payload=payload, corr=corr)
        try:
            await self._redis.xadd(
                self._stream,
                {"data": env.model_dump_json(exclude={"id"})},
                maxlen=self._maxlen,
                approximate=True,
            )
        except Exception as exc:  # noqa: BLE001 — fire-and-forget by contract
            logger.warning("emit dropped (%s: %s)", type, exc)

    async def history(self, count: int) -> list[Envelope]:
        entries = await self._redis.xrevrange(self._stream, count=count)
        return [e for e in (self._parse(i, f) for i, f in reversed(entries)) if e]

    async def tail(
        self, last_id: str, *, block_ms: int = 1000, count: int = 500
    ) -> list[Envelope]:
        result = await self._redis.xread({self._stream: last_id}, block=block_ms, count=count)
        if not result:
            return []
        _, entries = result[0]
        return [e for e in (self._parse(i, f) for i, f in entries) if e]

    def _parse(self, entry_id: str, fields: dict) -> Envelope | None:
        try:
            env = Envelope.model_validate(json.loads(fields["data"]))
            env.id = entry_id
            return env
        except Exception:  # noqa: BLE001
            logger.warning("skipping malformed stream entry %s", entry_id)
            return None
