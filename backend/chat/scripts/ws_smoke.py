#!/usr/bin/env python3
"""End-to-end smoke test for the chat service: cross-node message fanout.

What it proves: a message sent by Alice's socket is delivered to Bob's socket
through Postgres (durable, ordered) + Redis pub/sub (fanout) — the §4.2 path.

It seeds the DB directly (two users, one channel, both joined) and mints JWTs via
``shared.auth`` rather than going through the REST api-service, because channel
CRUD isn't implemented there yet. Once it is, this can switch to the REST path.

Prerequisites — a reachable Postgres + Redis and a running chat service:

    # 1. infra (from infra/compose): postgres + redis + migrate
    docker compose up -d postgres redis migrate

    # 2. the chat service, pointed at them (from backend/, in a venv with
    #    the chat + shared packages installed):
    DATABASE_URL=postgresql+asyncpg://chorus:<pw>@localhost:5432/chorus \
    REDIS_URL=redis://localhost:6379/0 JWT_SECRET=<secret> \
      uvicorn chat.main:app --port 8000

    # 3. this script (same DATABASE_URL / REDIS_URL / JWT_SECRET env):
    WS_URL=ws://localhost:8000/ws python backend/chat/scripts/ws_smoke.py

Exits 0 on success, non-zero with a diagnostic on failure. Pass --cleanup to
remove the seeded fixtures.
"""

import asyncio
import json
import os
import sys

import websockets
from sqlalchemy import delete, select

from shared.auth import create_access_token
from shared.db import async_session_factory
from shared.models import Channel, ChannelMember, Message, User

WS_URL = os.environ.get("WS_URL", "ws://localhost:8000/ws")

ALICE = "smoke_alice"
BOB = "smoke_bob"
CHANNEL = "smoke_channel"


async def _seed() -> tuple[int, int, int]:
    """Idempotently create two users + one channel + memberships. Returns
    ``(alice_id, bob_id, channel_id)``."""
    async with async_session_factory() as s:
        ids = {}
        for name in (ALICE, BOB):
            user = (
                await s.execute(select(User).where(User.username == name))
            ).scalar_one_or_none()
            if user is None:
                user = User(
                    username=name,
                    email=f"{name}@smoke.test",
                    password_hash="x",  # never used; we mint JWTs directly
                )
                s.add(user)
                await s.flush()
            ids[name] = user.id

        channel = (
            await s.execute(select(Channel).where(Channel.name == CHANNEL))
        ).scalar_one_or_none()
        if channel is None:
            channel = Channel(name=CHANNEL, created_by=ids[ALICE])
            s.add(channel)
            await s.flush()

        for uid in ids.values():
            member = (
                await s.execute(
                    select(ChannelMember).where(
                        ChannelMember.channel_id == channel.id,
                        ChannelMember.user_id == uid,
                    )
                )
            ).scalar_one_or_none()
            if member is None:
                s.add(ChannelMember(channel_id=channel.id, user_id=uid))

        await s.commit()
        return ids[ALICE], ids[BOB], channel.id


async def _recv_until(ws, want_type: str, timeout: float = 5.0) -> dict:
    """Read frames until one with ``type == want_type`` arrives, or time out."""
    async with asyncio.timeout(timeout):
        while True:
            frame = json.loads(await ws.recv())
            if frame.get("type") == want_type:
                return frame


async def main() -> int:
    alice_id, bob_id, channel_id = await _seed()
    alice_token = create_access_token(alice_id)
    bob_token = create_access_token(bob_id)

    async with (
        websockets.connect(f"{WS_URL}?token={alice_token}") as alice,
        websockets.connect(f"{WS_URL}?token={bob_token}") as bob,
    ):
        # Both sides finish their handshake (connect -> ready).
        await _recv_until(alice, "ready")
        await _recv_until(bob, "ready")

        body = "hello from the smoke test"
        await alice.send(
            json.dumps({"type": "message", "channel_id": channel_id, "body": body})
        )

        # The fanout path delivers to BOTH sockets (sender included).
        bob_msg = await _recv_until(bob, "message")
        alice_msg = await _recv_until(alice, "message")

    ok = True
    for who, msg in (("bob", bob_msg), ("alice", alice_msg)):
        if (
            msg["body"] != body
            or msg["sender_id"] != alice_id
            or msg["channel_id"] != channel_id
        ):
            print(f"FAIL: {who} received unexpected message: {msg}", file=sys.stderr)
            ok = False
    if ok and bob_msg["id"] != alice_msg["id"]:
        print(
            f"FAIL: id mismatch — alice saw {alice_msg['id']}, bob saw {bob_msg['id']}",
            file=sys.stderr,
        )
        ok = False

    if ok:
        print(
            f"PASS: message id={bob_msg['id']} fanned out to both sockets via Redis pub/sub"
        )
    return 0 if ok else 1


async def _cleanup() -> None:
    """Remove smoke fixtures so reruns start clean (best-effort)."""
    async with async_session_factory() as s:
        users = (
            (await s.execute(select(User).where(User.username.in_([ALICE, BOB]))))
            .scalars()
            .all()
        )
        channel = (
            await s.execute(select(Channel).where(Channel.name == CHANNEL))
        ).scalar_one_or_none()
        if channel is not None:
            await s.execute(delete(Message).where(Message.channel_id == channel.id))
            await s.execute(
                delete(ChannelMember).where(ChannelMember.channel_id == channel.id)
            )
            await s.delete(channel)
        for u in users:
            await s.delete(u)
        await s.commit()


if __name__ == "__main__":
    if "--cleanup" in sys.argv:
        asyncio.run(_cleanup())
        print("cleaned up smoke fixtures")
        sys.exit(0)
    sys.exit(asyncio.run(main()))
