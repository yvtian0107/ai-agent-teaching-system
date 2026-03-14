"""Tests for session_service.py"""

from agno.session.agent import AgentSession
from agno.session.summary import SessionSummary

from src.services.session_service import SessionService, SessionNotFoundError
import pytest


class _FakeDb:
    def __init__(self, sessions=None):
        self._sessions = sessions or []
        self.deleted_ids = []
        self.upserted_sessions = []

    def get_sessions(self, **kwargs):
        return self._sessions

    def delete_session(self, **kwargs):
        self.deleted_ids.append(kwargs.get("session_id"))
        return True

    def upsert_session(self, session):
        self.upserted_sessions.append(session)
        for idx, existing in enumerate(self._sessions):
            if existing.session_id == session.session_id:
                self._sessions[idx] = session
                return True
        self._sessions.append(session)
        return True


def _make_fake_sessions():
    return [
        AgentSession(
            session_id="s1",
            agent_id="a1",
            user_id="u1",
            summary=SessionSummary(summary="title-1"),
            created_at=10,
            updated_at=100,
            runs=[],
        ),
        AgentSession(
            session_id="s2",
            agent_id="a2",
            user_id="u1",
            summary=SessionSummary(summary="title-2"),
            created_at=20,
            updated_at=200,
            runs=[],
        ),
    ]


def test_list_sessions_sorted_by_updated_at_desc() -> None:
    service = SessionService(user_id="u1")
    service.db = _FakeDb(_make_fake_sessions())

    result, total = service.list_sessions()

    assert total == 2
    assert result[0]["session_id"] == "s2"
    assert result[1]["session_id"] == "s1"


def test_list_sessions_filter_by_agent_id() -> None:
    service = SessionService(user_id="u1")
    service.db = _FakeDb(_make_fake_sessions())

    result, total = service.list_sessions(agent_id="a1")

    assert total == 1
    assert result[0]["session_id"] == "s1"


def test_get_session_returns_details() -> None:
    service = SessionService(user_id="u1")
    service.db = _FakeDb(_make_fake_sessions())

    result = service.get_session("s1")

    assert result["session_id"] == "s1"
    assert result["title"] == "title-1"
    assert "messages" in result


def test_get_session_not_found_raises() -> None:
    service = SessionService(user_id="u1")
    service.db = _FakeDb(_make_fake_sessions())

    with pytest.raises(SessionNotFoundError):
        service.get_session("nonexistent")


def test_delete_session_calls_db() -> None:
    service = SessionService(user_id="u-del")
    fake_db = _FakeDb(_make_fake_sessions())
    service.db = fake_db

    service.delete_session("s1")

    assert "s1" in fake_db.deleted_ids


def test_delete_session_not_found_raises() -> None:
    service = SessionService(user_id="u-del")
    service.db = _FakeDb(_make_fake_sessions())

    with pytest.raises(SessionNotFoundError):
        service.delete_session("nonexistent")


def test_update_session_title_updates_summary_and_upserts() -> None:
    service = SessionService(user_id="u1")
    fake_db = _FakeDb(_make_fake_sessions())
    service.db = fake_db

    result = service.update_session_title("s1", "新的标题")

    assert result["title"] == "新的标题"
    assert len(fake_db.upserted_sessions) == 1
    assert fake_db.upserted_sessions[0].summary.summary == "新的标题"


@pytest.mark.asyncio
async def test_generate_and_update_session_title_backfills_title(monkeypatch) -> None:
    service = SessionService(user_id="u1")
    fake_db = _FakeDb(_make_fake_sessions())
    service.db = fake_db

    async def _fake_generate_title(messages):
        return "回填标题"

    monkeypatch.setattr("src.services.session_service.generate_title", _fake_generate_title)

    await service.generate_and_update_session_title(
        session_id="s1",
        messages=[{"role": "user", "content": "hello"}],
    )

    assert len(fake_db.upserted_sessions) == 1
    assert fake_db.upserted_sessions[0].summary.summary == "回填标题"
