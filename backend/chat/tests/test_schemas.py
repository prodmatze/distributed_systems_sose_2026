"""Unit tests for the WebSocket wire schemas."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from chat.schemas import ChatMessage, ErrorEvent, InboundMessage, ReadyEvent


def test_inbound_message_parses_valid_frame():
    msg = InboundMessage.model_validate({"type": "message", "channel_id": 1, "body": "hi"})
    assert msg.channel_id == 1
    assert msg.body == "hi"


def test_inbound_message_rejects_empty_body():
    with pytest.raises(ValidationError):
        InboundMessage.model_validate({"channel_id": 1, "body": ""})


def test_inbound_message_rejects_oversized_body():
    with pytest.raises(ValidationError):
        InboundMessage.model_validate({"channel_id": 1, "body": "x" * 4001})


def test_inbound_message_requires_channel_id():
    with pytest.raises(ValidationError):
        InboundMessage.model_validate({"body": "hi"})


def test_chat_message_serializes_datetime_to_json():
    created = datetime(2026, 5, 31, 12, 0, tzinfo=timezone.utc)
    msg = ChatMessage(
        id=42,
        channel_id=1,
        sender_id=3,
        sender_username="alice",
        body="hi",
        created_at=created,
    )
    dumped = msg.model_dump(mode="json")
    assert dumped["type"] == "message"
    assert dumped["id"] == 42
    assert dumped["sender_username"] == "alice"
    assert isinstance(dumped["created_at"], str)  # JSON-safe, not a datetime


def test_ready_and_error_events_carry_their_type():
    assert ReadyEvent(channels=[1, 2]).model_dump()["type"] == "ready"
    assert ErrorEvent(detail="nope").model_dump() == {"type": "error", "detail": "nope"}
