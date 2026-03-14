from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
import jwt
import pytest

from src.middleware.auth import AuthMiddleware
from src.core.settings import settings


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/status")
    async def status() -> dict:
        return {"status": "ok"}

    @app.get("/api/sessions")
    async def list_sessions(request: Request) -> dict:
        return {"user": request.state.user}

    @app.options("/api/sessions")
    async def preflight_sessions() -> dict:
        return {"ok": True}

    @app.get("/agents/demo/agui")
    async def public_agent_endpoint(request: Request) -> dict:
        user = getattr(request.state, "user", None)
        return {
            "has_user": bool(user),
            "sub": user.get("sub") if isinstance(user, dict) else None,
        }

    return app


def _build_cors_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3010"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/sessions")
    async def list_sessions(request: Request) -> dict:
        return {"user": request.state.user}

    return app


def test_rejects_missing_bearer_token() -> None:
    app = _build_app()
    with TestClient(app) as client:
        resp = client.get("/api/sessions")
    assert resp.status_code == 401


def test_allows_public_status_without_token() -> None:
    app = _build_app()
    with TestClient(app) as client:
        resp = client.get("/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_accepts_valid_jwt_and_sets_user_context() -> None:
    original_secret = settings.supabase.jwt_secret
    settings.supabase.jwt_secret = "unit-test-secret-32-bytes-long-key"

    token = jwt.encode(
        {"sub": "user-123", "aud": "authenticated", "role": "authenticated"},
        settings.supabase.jwt_secret,
        algorithm="HS256",
    )

    app = _build_app()
    try:
        with TestClient(app) as client:
            resp = client.get(
                "/api/sessions",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 200
        assert resp.json()["user"]["sub"] == "user-123"
    finally:
        settings.supabase.jwt_secret = original_secret


def test_allows_options_preflight_without_token() -> None:
    app = _build_app()
    with TestClient(app) as client:
        resp = client.options(
            "/api/sessions",
            headers={
                "Origin": "http://localhost:3010",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    assert resp.status_code == 200


def test_preflight_on_protected_path_returns_cors_headers() -> None:
    app = _build_cors_app()
    with TestClient(app) as client:
        resp = client.options(
            "/api/sessions",
            headers={
                "Origin": "http://localhost:3010",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3010"


def test_unauthorized_response_keeps_cors_headers() -> None:
    app = _build_cors_app()
    with TestClient(app) as client:
        resp = client.get(
            "/api/sessions",
            headers={"Origin": "http://localhost:3010"},
        )

    assert resp.status_code == 401
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3010"


def test_fallback_to_supabase_verification_when_jwt_secret_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_secret = settings.supabase.jwt_secret
    settings.supabase.jwt_secret = ""

    token = "fake-token-for-fallback"

    def _fake_verify(self, incoming_token: str):
        assert incoming_token == token
        return {"sub": "fallback-user", "email": "fallback@example.com"}

    monkeypatch.setattr(AuthMiddleware, "_verify_with_supabase", _fake_verify)

    app = _build_app()
    try:
        with TestClient(app) as client:
            resp = client.get(
                "/api/sessions",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 200
        assert resp.json()["user"]["sub"] == "fallback-user"
    finally:
        settings.supabase.jwt_secret = original_secret


def test_sets_user_id_in_request_state_from_verified_payload() -> None:
    original_secret = settings.supabase.jwt_secret
    settings.supabase.jwt_secret = "unit-test-secret-32-bytes-long-key"

    token = jwt.encode(
        {"sub": "user-state-1", "aud": "authenticated", "role": "authenticated"},
        settings.supabase.jwt_secret,
        algorithm="HS256",
    )

    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/private")
    async def private(request: Request) -> dict:
        return {
            "sub": request.state.user.get("sub"),
            "user_id": request.state.user_id,
        }

    try:
        with TestClient(app) as client:
            resp = client.get("/private", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["sub"] == "user-state-1"
        assert data["user_id"] == "user-state-1"
    finally:
        settings.supabase.jwt_secret = original_secret


def test_public_agents_path_optionally_attaches_user_context() -> None:
    original_secret = settings.supabase.jwt_secret
    settings.supabase.jwt_secret = "unit-test-secret-32-bytes-long-key"

    token = jwt.encode(
        {"sub": "public-user-1", "aud": "authenticated", "role": "authenticated"},
        settings.supabase.jwt_secret,
        algorithm="HS256",
    )

    app = _build_app()
    try:
        with TestClient(app) as client:
            resp = client.get(
                "/agents/demo/agui",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["has_user"] is True
        assert payload["sub"] == "public-user-1"
    finally:
        settings.supabase.jwt_secret = original_secret
