"""Tests for sessions API - get_current_user_id dependency."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.api.sessions import get_current_user_id


class _DummyRequest:
    def __init__(self, state: SimpleNamespace):
        self.state = state


@pytest.mark.asyncio
async def test_get_current_user_id_from_state_user_id() -> None:
    request = _DummyRequest(state=SimpleNamespace(user_id="user-1"))
    assert await get_current_user_id(request) == "user-1"


@pytest.mark.asyncio
async def test_get_current_user_id_from_state_user_sub() -> None:
    request = _DummyRequest(state=SimpleNamespace(user={"sub": "user-2"}))
    assert await get_current_user_id(request) == "user-2"


@pytest.mark.asyncio
async def test_get_current_user_id_from_state_user_dict_user_id() -> None:
    request = _DummyRequest(state=SimpleNamespace(user={"user_id": "user-3"}))
    assert await get_current_user_id(request) == "user-3"


@pytest.mark.asyncio
async def test_get_current_user_id_raises_401_when_no_user() -> None:
    request = _DummyRequest(state=SimpleNamespace())
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_id(request)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_id_prefers_user_id_over_user_dict() -> None:
    """When both user_id and user dict exist, user_id takes precedence."""
    request = _DummyRequest(
        state=SimpleNamespace(user_id="direct-id", user={"sub": "dict-id"})
    )
    assert await get_current_user_id(request) == "direct-id"
