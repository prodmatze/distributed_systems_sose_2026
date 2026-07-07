"""Redis tap: chat traffic + presence transitions, with zero chat-service changes.

Two subscriptions on ONE long-lived pubsub (the hard-won lesson from
chat/pubsub.py — never recreate the pubsub object per iteration):

* ``chan:*``            — every message any replica publishes (fanout firehose)
* ``__keyevent@0__:*``  — keyspace notifications; presence:<uid> set/expired/del
                          become online/offline events. TTL refreshes (set on an
                          already-online user) are deliberately silent.

``CONFIG SET notify-keyspace-events Eg$xn`` is asserted at startup as
belt-and-suspenders — compose sets the same flags declaratively.

chat.message is token-bucketed (20/s, burst 40); overflow folds into periodic
``chat.message.summary`` events so a flood degrades gracefully on the bus.
"""

import asyncio
import json
import logging
import time

from observer.bus import Bus

logger = logging.getLogger("observer.producers.redis_tap")

CHAT_PATTERN = "chan:*"
KEYEVENT_PATTERN = "__keyevent@0__:*"
_RATE_PER_S = 20.0
_BURST = 40.0
_SUMMARY_FLUSH_S = 2.0


def translate(
    channel: str, data: str, known_online: set[int]
) -> tuple[str, str, dict] | None:
    """Pure mapping of one pmessage -> (type, service, payload), or None to drop."""
    if channel.startswith("chan:"):
        try:
            payload = json.loads(data)
            channel_id = int(channel.removeprefix("chan:"))
        except (ValueError, TypeError):
            return None
        return "chat.message", "chat", {"channel_id": channel_id, "message": payload}

    if channel.startswith("__keyevent@0__:"):
        event = channel.rsplit(":", 1)[1]
        if not data.startswith("presence:"):
            return None
        try:
            user_id = int(data.removeprefix("presence:"))
        except ValueError:
            return None
        if event == "set":
            if user_id in known_online:
                return None                      # TTL refresh — silent
            return "presence.online", "chat", {"user_id": user_id}
        if event in ("expired", "del"):
            return "presence.offline", "chat", {"user_id": user_id}
    return None


async def run_redis_tap(redis_factory, bus: Bus) -> None:
    redis = redis_factory()
    pubsub = None
    try:
        try:
            await redis.config_set("notify-keyspace-events", "Eg$xn")
        except Exception:  # noqa: BLE001 — compose sets it declaratively too
            logger.warning("could not CONFIG SET notify-keyspace-events (non-fatal)")

        pubsub = redis.pubsub()
        await pubsub.psubscribe(CHAT_PATTERN, KEYEVENT_PATTERN)
        logger.info("redis tap subscribed to %s, %s", CHAT_PATTERN, KEYEVENT_PATTERN)

        known_online: set[int] = set()
        tokens, last_refill = _BURST, time.monotonic()
        summary_count, last_flush = 0, time.monotonic()

        while True:
            raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            now = time.monotonic()
            tokens = min(_BURST, tokens + (now - last_refill) * _RATE_PER_S)
            last_refill = now

            if summary_count and now - last_flush >= _SUMMARY_FLUSH_S:
                await bus.emit(type="chat.message.summary", service="chat",
                               payload={"count": summary_count})
                summary_count, last_flush = 0, now

            if raw is None or raw.get("type") != "pmessage":
                continue

            out = translate(raw["channel"], raw["data"], known_online)
            if out is None:
                continue
            type_, service, payload = out

            if type_ == "presence.online":
                known_online.add(payload["user_id"])
            elif type_ == "presence.offline":
                known_online.discard(payload["user_id"])

            if type_ == "chat.message":
                if tokens < 1.0:
                    summary_count += 1
                    continue
                tokens -= 1.0

            await bus.emit(type=type_, service=service, payload=payload)
    finally:
        if pubsub is not None:
            await pubsub.aclose()
        await redis.aclose()
