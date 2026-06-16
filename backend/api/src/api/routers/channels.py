"""Channel domain: create, list, join, and message history.

Stateless REST over the shared Postgres. Every route requires a valid JWT
(`get_current_user`). Message *writes* happen on chat-service over WebSocket;
this router only *reads* history and manages channels + membership.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user
from api.schemas import ChannelCreate, ChannelResponse, MessageResponse
from shared.db import get_session
from shared.models import Channel, ChannelMember, Message, User

router = APIRouter(prefix="/api/channels", tags=["channels"])


async def _member_count(session: AsyncSession, channel_id: int) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(ChannelMember)
        .where(ChannelMember.channel_id == channel_id)
    )
    return count or 0


@router.post("", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChannelResponse:
    existing = await session.scalar(select(Channel).where(Channel.name == payload.name))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "channel name already taken")

    channel = Channel(
        name=payload.name, description=payload.description, created_by=user.id
    )
    session.add(channel)
    await session.flush()  # assign channel.id before referencing it
    session.add(ChannelMember(channel_id=channel.id, user_id=user.id))  # creator joins
    await session.commit()
    await session.refresh(channel)
    return ChannelResponse(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        member_count=1,
        created_at=channel.created_at,
    )


@router.get("", response_model=list[ChannelResponse])
async def list_channels(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ChannelResponse]:
    rows = (
        await session.execute(
            select(Channel, func.count(ChannelMember.user_id))
            .outerjoin(ChannelMember, ChannelMember.channel_id == Channel.id)
            .group_by(Channel.id)
            .order_by(Channel.name)
        )
    ).all()
    return [
        ChannelResponse(
            id=c.id,
            name=c.name,
            description=c.description,
            member_count=count,
            created_at=c.created_at,
        )
        for c, count in rows
    ]


@router.post("/{channel_id}/join", response_model=ChannelResponse)
async def join_channel(
    channel_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChannelResponse:
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")

    membership = await session.get(ChannelMember, (channel_id, user.id))
    if membership is None:  # idempotent — only insert if not already a member
        session.add(ChannelMember(channel_id=channel_id, user_id=user.id))
        await session.commit()

    return ChannelResponse(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        member_count=await _member_count(session, channel_id),
        created_at=channel.created_at,
    )


@router.get("/{channel_id}/messages", response_model=list[MessageResponse])
async def channel_history(
    channel_id: int,
    before: int | None = Query(None, description="return messages with id < before"),
    limit: int = Query(50, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MessageResponse]:
    membership = await session.get(ChannelMember, (channel_id, user.id))
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a member of this channel")

    stmt = (
        select(Message, User.username)
        .join(User, Message.sender_id == User.id)
        .where(Message.channel_id == channel_id)
    )
    if before is not None:
        stmt = stmt.where(Message.id < before)
    # newest-first for the LIMIT, then flip to ascending for display
    stmt = stmt.order_by(Message.id.desc()).limit(limit)
    rows = list(reversed((await session.execute(stmt)).all()))
    return [
        MessageResponse(
            id=m.id,
            channel_id=m.channel_id,
            sender_id=m.sender_id,
            sender_username=username,
            body=m.body,
            created_at=m.created_at,
        )
        for m, username in rows
    ]
