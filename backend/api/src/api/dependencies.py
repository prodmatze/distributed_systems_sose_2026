"""Shared FastAPI dependencies for api-service — primarily authentication.

`get_current_user` is the single chokepoint that turns a bearer JWT into a
`User`. Every protected endpoint declares `Depends(get_current_user)`; none
re-implement token handling. Tokens are *issued* by auth-service and merely
*verified* here, both via `shared.auth` — one source of truth for the format.
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import decode_access_token
from shared.db import get_session
from shared.models import User

# tokenUrl powers the "Authorize" button in /docs. Auth lives on a separate
# service, so we point at its gateway-relative path.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise credentials_error

    user = await session.get(User, user_id)
    if user is None:
        raise credentials_error
    return user
