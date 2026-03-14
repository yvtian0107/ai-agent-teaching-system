"""Tests for P1 admin user status and password reset behaviors."""

from types import SimpleNamespace

import pytest

from src.services.admin_user_service import (
    AdminNotFoundError,
    AdminUserService,
    AdminValidationError,
)


class _FakeProfilesTable:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self.last_update_payload: dict | None = None
        self._target_user_id: str | None = None

    def update(self, payload: dict):
        self.last_update_payload = payload
        return self

    def eq(self, field: str, value: str):
        assert field == "id"
        self._target_user_id = value
        return self

    def execute(self):
        if not self._target_user_id:
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=self._rows)


class _FakeAuthAdmin:
    def __init__(self):
        self.update_calls: list[tuple[str, dict]] = []

    def update_user_by_id(self, user_id: str, payload: dict):
        self.update_calls.append((user_id, payload))


class _FakeClient:
    def __init__(self, rows: list[dict]):
        self.profiles_table = _FakeProfilesTable(rows)
        self.auth = SimpleNamespace(admin=_FakeAuthAdmin())

    def table(self, name: str):
        assert name == "profiles"
        return self.profiles_table


@pytest.fixture
def setup_service(monkeypatch):
    fake_client = _FakeClient(rows=[{"id": "target-user"}])
    monkeypatch.setattr(
        "src.services.admin_user_service.get_supabase_client",
        lambda: fake_client,
    )

    service = AdminUserService(operator_user_id="operator-admin")
    monkeypatch.setattr(service, "_ensure_operator_is_admin", lambda: None)

    return service, fake_client


def test_set_user_status_requires_reason_when_suspended(setup_service) -> None:
    service, _ = setup_service
    service._get_profile = lambda _user_id: {
        "id": "u-1",
        "role": "student",
        "account_status": "active",
    }

    with pytest.raises(AdminValidationError, match="停用时必须填写原因"):
        service.set_user_status(user_id="u-1", status="suspended", reason="   ")


def test_set_user_status_disallows_suspending_self(setup_service) -> None:
    service, _ = setup_service
    service.operator_user_id = "self-user"
    service._get_profile = lambda _user_id: {
        "id": "self-user",
        "role": "admin",
        "account_status": "active",
    }

    with pytest.raises(AdminValidationError, match="不能停用自己"):
        service.set_user_status(user_id="self-user", status="suspended", reason="违规")


def test_set_user_status_disallows_last_active_admin_suspend(setup_service) -> None:
    service, _ = setup_service
    service._get_profile = lambda _user_id: {
        "id": "admin-target",
        "role": "admin",
        "account_status": "active",
    }
    service._count_active_admins = lambda: 1

    with pytest.raises(AdminValidationError, match="至少保留一个 active admin"):
        service.set_user_status(
            user_id="admin-target",
            status="suspended",
            reason="停用测试",
        )


def test_set_user_status_updates_profile_and_syncs_auth(setup_service) -> None:
    service, fake_client = setup_service
    sync_calls: list[dict] = []

    service._get_profile = lambda _user_id: {
        "id": "u-2",
        "role": "teacher",
        "account_status": "active",
    }
    service._sync_auth_ban_status = lambda **kwargs: sync_calls.append(kwargs)

    result = service.set_user_status(
        user_id="u-2",
        status="suspended",
        reason="长期未使用",
    )

    assert result == {"id": "target-user"}
    assert fake_client.profiles_table.last_update_payload == {
        "account_status": "suspended",
        "status_reason": "长期未使用",
    }
    assert sync_calls == [{"user_id": "u-2", "status": "suspended"}]


def test_set_user_status_clears_reason_when_reactivated(setup_service) -> None:
    service, fake_client = setup_service
    service._get_profile = lambda _user_id: {
        "id": "u-3",
        "role": "student",
        "account_status": "suspended",
    }
    service._sync_auth_ban_status = lambda **_kwargs: None

    service.set_user_status(
        user_id="u-3",
        status="active",
        reason="should-be-cleared",
    )

    assert fake_client.profiles_table.last_update_payload == {
        "account_status": "active",
        "status_reason": None,
    }


def test_reset_user_password_requires_min_length(setup_service) -> None:
    service, _ = setup_service

    with pytest.raises(AdminValidationError, match="密码至少 8 位"):
        service.reset_user_password(user_id="u-4", new_password="1234567")


def test_reset_user_password_raises_when_user_not_found(setup_service) -> None:
    service, _ = setup_service
    service._get_profile = lambda _user_id: None

    with pytest.raises(AdminNotFoundError, match="用户不存在"):
        service.reset_user_password(user_id="missing-user", new_password="Strong123")


def test_reset_user_password_calls_supabase_admin(setup_service) -> None:
    service, fake_client = setup_service
    service._get_profile = lambda _user_id: {
        "id": "u-5",
        "role": "teacher",
        "account_status": "active",
    }

    result = service.reset_user_password(user_id="u-5", new_password="Strong123")

    assert result == {"user_id": "u-5", "password_reset": True}
    assert fake_client.auth.admin.update_calls == [
        ("u-5", {"password": "Strong123"})
    ]
