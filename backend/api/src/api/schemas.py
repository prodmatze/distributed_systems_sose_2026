from pydantic import BaseModel, Field, EmailStr
from datetime import datetime

#input of POST /api/auth/register
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=12) #min_length=3, max_length=12
    password: str = Field(min_length=5, max_length=12) #min=5, max=12

#input of POST /api/auth/login
class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=12)
    password: str = Field(min_length=5, max_length=12)

#response for /api/users/me:
class UserResponse(BaseModel):
    id: int
    email: EmailStr
    username: str
    created_at: datetime

#response for both REGISTER & LOGIN
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserResponse










