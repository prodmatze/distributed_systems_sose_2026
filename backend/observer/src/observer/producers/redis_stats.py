"""Redis health poller: INFO + CLIENT LIST + PUBSUB NUMPAT + presence TTLs.

NUMPAT deserves a correction (live-discovered 2026-07-07, Task 9): it is NOT
a replica counter. PUBSUB NUMPAT counts distinct *pattern strings* currently
subscribed, not the number of clients subscribed to them. All chat replicas
share the literal pattern ``chan:*`` — that's one pattern string no matter
how many replicas hold it — plus the observer's own ``__keyevent@0__:*`` tap,
so NUMPAT sits flat at 2 regardless of replica count (we watched it stay at 2
while killing chat nodes). The real per-client count has to come from
CLIENT LIST: each row that holds a pattern subscription (``psub`` > 0) and
isn't one of the observer's own connections (``name != "observer"`` — every
observer-owned Redis connection sets that via ``client_name="observer"`` in
``_make_redis``, including the tap's own psubscribe) is a genuine chat
replica. We surface that count as ``chat_subscribers``; ``numpat`` is kept in
the payload too since it's still true raw data, just not a replica count.
"""

import asyncio
import logging

from observer.bus import Bus

logger = logging.getLogger("observer.producers.redis_stats")

_INTERVAL_S = 2.0


def build_payload(info: dict, clients: list[dict], numpat: int,
                  presence: list[tuple[str, int]]) -> dict:
    # chat_subscribers: real per-client replica count, derived from CLIENT LIST
    # rather than PUBSUB NUMPAT (see module docstring). redis-py's client_list()
    # returns dicts with string values, so psub needs an explicit int() parse.
    chat_subscribers = sum(
        1
        for c in clients
        if int(c.get("psub", 0) or 0) > 0 and c.get("name", "") != "observer"
    )
    return {
        "ops_per_sec": info.get("instantaneous_ops_per_sec", 0),
        "connected_clients": info.get("connected_clients", 0),
        "used_memory_human": info.get("used_memory_human", "?"),
        "total_commands": info.get("total_commands_processed", 0),
        "numpat": numpat,
        "chat_subscribers": chat_subscribers,
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
