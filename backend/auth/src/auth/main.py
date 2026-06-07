import logging

from fastapi import Depends, FastAPI, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from shared.auth import create_access_token, hash_password, verify_password
from shared.db import get_session
from shared.models import User

# Reuse uvicorn's logger so these lines appear in the same stream as the
# access logs, at INFO, without extra logging configuration.
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="Chorus Auth")


@app.get("/auth/health")
async def health_check():
    return {"ok": True, "service": "auth"}


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    # 1. reject duplicate username or email
    existing = await session.execute(
        select(User).where(
            or_(User.username == payload.username, User.email == payload.email)
        )
    )
    if existing.scalar_one_or_none() is not None:
        logger.warning("register REJECTED (duplicate) username=%s", payload.username)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="username or email already taken",
        )

    # 2. create user with hashed password
    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
    )

    # 3. persist
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # 4. issue JWT and respond
    logger.info("register OK id=%s username=%s", user.id, user.username)
    return TokenResponse(
        access_token=create_access_token(user.id),
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@app.post("/auth/login")
async def login_user(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    # 1. find user by username
    result = await session.execute(
        select(User).where(User.username == payload.username)
    )
    user = result.scalar_one_or_none()

    # 2. verify password (same error for missing user vs wrong password — don't leak which)
    if user is None or not verify_password(payload.password, user.password_hash):
        logger.warning("login FAILED username=%s", payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid username or password",
        )

    # 3. issue JWT and respond
    logger.info("login OK id=%s username=%s", user.id, user.username)
    return TokenResponse(
        access_token=create_access_token(user.id),
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )
