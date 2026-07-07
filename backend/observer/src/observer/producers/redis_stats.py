"""Redis health poller: INFO + CLIENT LIST + PUBSUB NUMPAT + presence TTLs.

NUMPAT deserves a comment: every chat replica holds exactly one chan:* pattern
subscription, so PUBSUB NUMPAT literally equals the number of live chat
replicas — the cheapest replica counter in the whole system. (PUBSUB CHANNELS
is useless here: it excludes pattern subscribers, and this app has only those.)
"""

import asyncio
import logging

from observer.bus import Bus

logger = logging.getLogger("observer.producers.redis_stats")

_INTERVAL_S = 2.0


def build_payload(info: dict, clients: list[dict], numpat: int,
                  presence: list[tuple[str, int]]) -> dict:
    return {
        "ops_per_sec": info.get("instantaneous_ops_per_sec", 0),
        "connected_clients": info.get("connected_clients", 0),
        "used_memory_human": info.get("used_memory_human", "?"),
        "total_commands": info.get("total_commands_processed", 0),
        "numpat": numpat,
        "clients": [
            {"name": c.get("name", ""), "addr": c.get("addr", ""), "cmd": c.get("cmd", "")}
            for c in clients
        ],
        "presence": [{"user_id": int(uid), "ttl": ttl} for uid, ttl in presence],
    }


async def run_redis_stats(redis_factory, bus: Bus) -> None:
    redis = redis_factory()
    try:
        while True:
            info = await redis.info()
            clients = await redis.client_list()
            numpat = await redis.pubsub_numpat()
            presence: list[tuple[str, int]] = []
            async for key in redis.scan_iter(match="presence:*", count=100):
                ttl = await redis.ttl(key)
                presence.append((key.removeprefix("presence:"), ttl))
            await bus.emit(type="redis.stats", service="redis",
                           payload=build_payload(info, clients, numpat, presence))
            await asyncio.sleep(_INTERVAL_S)
    finally:
        await redis.aclose()
