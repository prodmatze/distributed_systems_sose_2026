"""Redis pub/sub bridge — the cross-node coupling between chat-service replicas.

One Redis channel per chat channel, keyed ``chan:<channel_id>``. When any
replica writes a message to Postgres it ``PUBLISH``es the canonical payload onto
that key; every replica receives it and fans it out to its local sockets.

Design choice — pattern subscription over dynamic per-channel subscribe:
We ``PSUBSCRIBE chan:*`` once at startup instead of subscribing/unsubscribing as
clients join and leave channels. This sidesteps the redis-py footgun where a
``PubSub`` object is mutated from request coroutines while a listener task is
blocked reading it (not concurrency-safe). The cost is that every replica
receives every channel's traffic and filters locally — negligible at demo scale,
and ``ConnectionManager.fanout`` is a no-op when there are no local subscribers.
If channel volume ever outgrows this, move to per-channel subscribe funnelled
through a single asyncio.Queue owned by the listener task.

Fire-and-forget by design: durability is Postgres's job, not this path's.
"""

import asyncio
import json
import logging

from redis.asyncio import Redis

from chat.connections import ConnectionManager

logger = logging.getLogger("chat.pubsub")

CHANNEL_PREFIX = "chan:"
PATTERN = "chan:*"


class PubSubBridge:
    def __init__(self, redis: Redis, manager: ConnectionManager) -> None:
        self._redis = redis
        self._manager = manager
        self._pubsub = redis.pubsub()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await self._pubsub.psubscribe(PATTERN)
        self._task = asyncio.create_task(self._listen(), name="pubsub-listener")
        logger.info("pubsub listener started on pattern %s", PATTERN)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._pubsub.punsubscribe(PATTERN)
        await self._pubsub.aclose()
        logger.info("pubsub listener stopped")

    async def publish(self, channel_id: int, payload: dict) -> None:
        """Publish an already-JSON-serializable payload to ``chan:<channel_id>``."""
        await self._redis.publish(f"{CHANNEL_PREFIX}{channel_id}", json.dumps(payload))

    async def _listen(self) -> None:
        async for raw in self._pubsub.listen():
            if raw.get("type") != "pmessage":
                continue  # skip (p)subscribe confirmations
            try:
                payload = json.loads(raw["data"])
                channel_id = int(payload["channel_id"])
            except (ValueError, TypeError, KeyError):
                logger.warning("dropping malformed pubsub payload: %r", raw.get("data"))
                continue
            await self._manager.fanout(channel_id, payload)
