"""User profile endpoints."""

from fastapi import APIRouter, Depends

from api.dependencies import get_current_user
from api.schemas import UserResponse
from shared.models import User

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    return user
