from sqlalchemy.exc import DatabaseError
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from api.schemas import RegisterRequest, LoginRequest, TokenResponse, UserResponse
from shared.models import User
from shared.db import get_session
from shared.auth import hash_password, verify_password, create_access_token, decode_access_token

app = FastAPI(title="Chorus API")

@app.get('/api/health')
async def health_check():
    return {'ok': True}

@app.get('/api/channels')
async def get_channels():
    return ['Channel_1', 'Channel_2', 'Channel_3']

@app.post('/api/auth/register')
async def register_user(payload: RegisterRequest, session: AsyncSession = Depends(get_session())) -> TokenResponse: #get/start a session from fastAPI 

    #1. check if username or email are already taken:
    existing = await session.execute(select(User).where(or_(User.username==payload.username, User.email == payload.email))) 
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code = status.HTTP_409_CONFLICT,
            detail = 'username or email already taken'
        )

    #2. construct new user object (in python memory)
    user_obj = {
        'username': payload.username,
        'email': payload.email,
        'password_hash': hash_password(payload.password),
    }
    user = User(**user_obj)

    #3. stage it, commit to postgres refresh to load db-generated fields
    session.add(user)
    await session.commit()
    await session.refresh(user)

    #4. issue JWT for the new user
    token = create_access_token(user.id)

    #5. build and return the response
    user_response = UserResponse.model_validate(user)
    token_response = TokenResponse(access_token=token, token_type='bearer', user=user_response)

    return token_response
