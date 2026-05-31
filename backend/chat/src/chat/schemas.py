"""WebSocket message envelopes for the chat protocol.

The wire format is JSON. Every frame carries a ``type`` discriminator.

Inbound (client -> server):
    {"type": "message", "channel_id": 1, "body": "hi"}
    {"type": "ping"}

Outbound (server -> client):
    {"type": "ready",   "channels": [1, 2]}
    {"type": "message", "id": 42, "channel_id": 1, "sender_id": 3,
                        "sender_username": "alice", "body": "hi",
                        "created_at": "2026-05-31T12:00:00+00:00"}
    {"type": "pong"}
    {"type": "error",   "detail": "not a member of channel 7"}
"""

from datetime import datetime

from pydantic import BaseModel, Field


class InboundMessage(BaseModel):
    """A message the client wants to send to a channel."""

    type: str = "message"
    channel_id: int
    body: str = Field(min_length=1, max_length=4000)


class ChatMessage(BaseModel):
    """The canonical, server-assigned form of a message.

    This is what gets published to Redis and fanned out to every subscriber
    (including the original sender's own connection). ``id`` is the Postgres
    ``bigserial`` — the system's ordering authority. Clients sort by it.
    """

    type: str = "message"
    id: int
    channel_id: int
    sender_id: int
    sender_username: str
    body: str
    created_at: datetime


class ReadyEvent(BaseModel):
    """Sent once after connect + backlog replay; live stream follows."""

    type: str = "ready"
    channels: list[int]


class ErrorEvent(BaseModel):
    type: str = "error"
    detail: str
