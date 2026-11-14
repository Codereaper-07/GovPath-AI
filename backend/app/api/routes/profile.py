"""The signed-in citizen's own profile. The user id always comes from the verified token."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, CurrentUser
from app.db import get_session
from app.models import CitizenProfile
from app.schemas.profile import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/me", tags=["profile"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _out(profile: CitizenProfile, user: AuthenticatedUser) -> ProfileOut:
    return ProfileOut(
        user_id=profile.id,
        email=user.email,
        full_name=profile.full_name,
        state=profile.state,
        city=profile.city,
        preferred_language=profile.preferred_language,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _get_or_create(session: AsyncSession, user: AuthenticatedUser) -> CitizenProfile:
    """The caller's profile, created on first access (seeded with the sign-up name)."""
    profile = await session.get(CitizenProfile, user.id)
    if profile is not None:
        return profile
    session.add(CitizenProfile(id=user.id, full_name=user.full_name))
    try:
        await session.commit()
    except IntegrityError:  # created concurrently by another request
        await session.rollback()
    profile = await session.get(CitizenProfile, user.id, populate_existing=True)
    if profile is None:  # e.g. the auth user no longer exists (foreign key)
        raise HTTPException(401, {"code": "invalid_token", "message": "Unknown user."})
    return profile


@router.get("/profile", response_model=ProfileOut)
async def get_profile(user: CurrentUser, session: Session) -> ProfileOut:
    return _out(await _get_or_create(session, user), user)


@router.patch("/profile", response_model=ProfileOut)
async def update_profile(body: ProfileUpdate, user: CurrentUser, session: Session) -> ProfileOut:
    profile = await _get_or_create(session, user)
    changes = body.model_dump(include=body.model_fields_set)
    if "preferred_language" in changes and changes["preferred_language"] is None:
        raise HTTPException(422, {"code": "invalid_language", "message": "Choose a language."})
    for field, value in changes.items():
        setattr(profile, field, value)
    if changes:
        await session.commit()
        await session.refresh(profile)
    return _out(profile, user)
