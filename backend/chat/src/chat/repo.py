"""Postgres access for the chat service.

Postgres is the durability + ordering authority. Every live message is written
here (assigning the monotonic ``messages.id``) *before* it is published to Redis,
and reconnecting clients replay missed history from here. We open a short-lived
session per operation via ``async_session_factory`` rather than holding one open
for the lifetime of a (long-lived) WebSocket.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import ChannelMember, Message, User


async def get_member_channel_ids(session: AsyncSession, user_id: int) -> set[int]:
    """The set of channels the user belongs to — the access-control boundary."""
    result = await session.execute(
        select(ChannelMember.channel_id).where(ChannelMember.user_id == user_id)
    )
    return set(result.scalars().all())


async def get_username(session: AsyncSession, user_id: int) -> str | None:
    result = await session.execute(select(User.username).where(User.id == user_id))
    return result.scalar_one_or_none()


async def insert_message(
    session: AsyncSession, channel_id: int, sender_id: int, body: str
) -> Message:
    """Persist a message and return it with the DB-assigned id + created_at."""
    message = Message(channel_id=channel_id, sender_id=sender_id, body=body)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def get_backlog(
    session: AsyncSession,
    channel_ids: set[int],
    after_id: int,
    limit: int = 200,
) -> list[tuple[Message, str]]:
    """Messages newer than ``after_id`` across the user's channels, oldest first.

    Returned as ``(Message, sender_username)`` pairs so the caller can build the
    canonical wire form without an extra lookup per row.
    """
    if not channel_ids:
        return []
    result = await session.execute(
        select(Message, User.username)
        .join(User, Message.sender_id == User.id)
        .where(Message.channel_id.in_(channel_ids), Message.id > after_id)
        .order_by(Message.id.asc())
        .limit(limit)
    )
    return [(row[0], row[1]) for row in result.all()]
