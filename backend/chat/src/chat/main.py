"""chat-service — FastAPI WebSocket endpoint for real-time messaging.

See docs/ARCHITECTURE.md §3.3 and §4.2-§4.4. The message lifecycle:

    client --ws--> this replica
        verify JWT, check membership
        INSERT messages RETURNING id   (Postgres = order + durability)
        PUBLISH chan:<id>              (Redis  = cross-node fanout)
    Redis --> every replica's listener --> local sockets in that channel

The sender receives their own message back through the same pub/sub fanout (this
process is PSUBSCRIBEd to chan:*), so there is exactly one delivery path and no
separate ack — every client, local or remote, sees an identically-ordered stream.
"""

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from redis.asyncio import Redis

from chat.auth import verify_token
from chat.connections import Connection, ConnectionManager
from chat.pubsub import PubSubBridge
from chat.repo import get_backlog, get_member_channel_ids, get_username, insert_message
from chat.schemas import ChatMessage, ErrorEvent, InboundMessage, ReadyEvent
from shared.db import async_session_factory
from shared.settings import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat.main")

PRESENCE_TTL_SECONDS = 30
BACKLOG_LIMIT = 200


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
    manager = ConnectionManager()
    bridge = PubSubBridge(redis, manager)
    await bridge.start()

    app.state.redis = redis
    app.state.manager = manager
    app.state.bridge = bridge
    try:
        yield
    finally:
        await bridge.stop()
        await redis.aclose()


app = FastAPI(title="Chorus Chat", lifespan=lifespan)


@app.get("/ws/health")
async def health_check():
    return {"ok": True, "service": "chat"}


async def _refresh_presence(redis: Redis, user_id: int) -> None:
    """Mark the user online with a short TTL; expiry handles disconnects."""
    await redis.set(f"presence:{user_id}", "1", ex=PRESENCE_TTL_SECONDS)


async def _send(ws: WebSocket, model) -> None:
    await ws.send_json(model.model_dump(mode="json"))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str | None = None, last_seen_id: int = 0):
    # Accept first, then close on failure: close-before-accept is handled
    # inconsistently across uvicorn's WS backends, accept-then-close is portable.
    await ws.accept()

    user_id = verify_token(token)
    if user_id is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with async_session_factory() as session:
        channel_ids = await get_member_channel_ids(session, user_id)
        username = await get_username(session, user_id)

    if username is None:  # token valid but user vanished
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    redis: Redis = ws.app.state.redis
    manager: ConnectionManager = ws.app.state.manager
    bridge: PubSubBridge = ws.app.state.bridge

    conn = Connection(ws=ws, user_id=user_id, username=username, channel_ids=channel_ids)
    manager.add(conn)
    logger.info("user %s (%s) connected, channels=%s", user_id, username, sorted(channel_ids))

    try:
        # Replay anything missed while disconnected, oldest first, before live stream.
        if last_seen_id > 0 and channel_ids:
            async with async_session_factory() as session:
                backlog = await get_backlog(session, channel_ids, last_seen_id, BACKLOG_LIMIT)
            for message, sender_username in backlog:
                await _send(ws, _to_chat_message(message, sender_username))

        await _send(ws, ReadyEvent(channels=sorted(channel_ids)))
        await _refresh_presence(redis, user_id)

        while True:
            try:
                raw = await ws.receive_json()
            except WebSocketDisconnect:
                break
            except (json.JSONDecodeError, RuntimeError):
                # JSONDecodeError: bad JSON. RuntimeError: a binary frame, which
                # Starlette's text-mode receive_json refuses. Either way the
                # client sent garbage — tell it and keep the socket open.
                await _send(ws, ErrorEvent(detail="expected a JSON text frame"))
                continue
            await _handle_inbound(raw, conn, manager, bridge, redis)
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(conn)
        logger.info("user %s disconnected", user_id)


async def _handle_inbound(
    raw: dict,
    conn: Connection,
    manager: ConnectionManager,
    bridge: PubSubBridge,
    redis: Redis,
) -> None:
    msg_type = raw.get("type") if isinstance(raw, dict) else None

    if msg_type == "ping":
        await conn.ws.send_json({"type": "pong"})
        await _refresh_presence(redis, conn.user_id)
        return

    if msg_type == "message":
        try:
            inbound = InboundMessage.model_validate(raw)
        except ValidationError:
            await _send(conn.ws, ErrorEvent(detail="invalid message frame"))
            return

        # Authorization: never trust the client's channel claim — check membership.
        if inbound.channel_id not in conn.channel_ids:
            await _send(
                conn.ws,
                ErrorEvent(detail=f"not a member of channel {inbound.channel_id}"),
            )
            return

        async with async_session_factory() as session:
            message = await insert_message(
                session, inbound.channel_id, conn.user_id, inbound.body
            )

        canonical = _to_chat_message(message, conn.username)
        # Publish only — fanout (incl. back to this sender) happens via the listener.
        await bridge.publish(inbound.channel_id, canonical.model_dump(mode="json"))
        await _refresh_presence(redis, conn.user_id)
        return

    await _send(conn.ws, ErrorEvent(detail=f"unknown message type: {msg_type!r}"))


def _to_chat_message(message, sender_username: str) -> ChatMessage:
    return ChatMessage(
        id=message.id,
        channel_id=message.channel_id,
        sender_id=message.sender_id,
        sender_username=sender_username,
        body=message.body,
        created_at=message.created_at,
    )
