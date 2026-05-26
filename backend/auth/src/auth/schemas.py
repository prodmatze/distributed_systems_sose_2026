from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=12)
    password: str = Field(min_length=5, max_length=12)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=12)
    password: str = Field(min_length=5, max_length=12)


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
