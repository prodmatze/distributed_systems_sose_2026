"""Request/response models for api-service.

Per-service schemas (not shared): only api-service speaks these shapes.
`from_attributes` lets FastAPI build a response straight from a SQLAlchemy row.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)


class ChannelResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    member_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: int
    channel_id: int
    sender_id: int
    sender_username: str
    body: str
    created_at: datetime


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}
