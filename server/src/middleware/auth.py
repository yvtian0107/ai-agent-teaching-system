from collections.abc import Awaitable, Callable

from loguru import logger
from fastapi import Request
from fastapi.responses import JSONResponse
from supabase import Client, create_client
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from src.core.security import decode_jwt_token
from src.core.settings import settings


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._public_paths = {
            "/status",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/api/agents",
        }
        self._auth_client: Client | None = None

        if not settings.supabase.jwt_secret.strip():
            logger.warning(
                "SUPABASE__JWT_SECRET is empty; auth will use Supabase fallback verification"
            )

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        authorization = request.headers.get("Authorization", "")
        token = authorization[7:] if authorization.startswith("Bearer ") else None

        if self._should_skip_auth(request):
            # Public routes remain accessible, but if a bearer token is provided
            # we still attach verified user context for downstream middlewares.
            if token:
                payload = self._resolve_payload(token)
                if payload is not None:
                    self._attach_user_context(request, payload)
            return await call_next(request)

        if not token:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        payload = self._resolve_payload(token)
        if payload is None:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        self._attach_user_context(request, payload)
        return await call_next(request)

    def _resolve_payload(self, token: str) -> dict | None:
        payload = self._decode_with_local_secret(token)
        if payload is not None:
            return payload
        return self._verify_with_supabase(token)

    def _attach_user_context(self, request: Request, payload: dict) -> None:
        request.state.user = payload
        user_id = payload.get("sub") or payload.get("user_id")
        if user_id:
            request.state.user_id = str(user_id)

    def _decode_with_local_secret(self, token: str) -> dict | None:
        jwt_secret = settings.supabase.jwt_secret.strip()
        if not jwt_secret:
            return None

        try:
            return decode_jwt_token(token, jwt_secret)
        except Exception as exc:
            logger.warning("JWT local verification failed, fallback to Supabase: {}", exc)
            return None

    def _verify_with_supabase(self, token: str) -> dict | None:
        client = self._get_auth_client()
        if client is None:
            return None

        try:
            response = client.auth.get_user(token)
            user = response.user if response else None
            if user is None:
                return None

            return {
                "sub": user.id,
                "email": user.email,
                "role": getattr(user, "role", "authenticated"),
            }
        except Exception as exc:
            logger.warning("Supabase token verification failed: {}", exc)
            return None

    def _get_auth_client(self) -> Client | None:
        if self._auth_client is not None:
            return self._auth_client

        url = settings.supabase.url.strip()
        key = settings.supabase.anon_key.strip() or settings.supabase.service_key.strip()
        if not url or not key:
            return None

        self._auth_client = create_client(url, key)
        return self._auth_client

    def _should_skip_auth(self, request: Request) -> bool:
        # Let CORS preflight pass through; browser OPTIONS requests do not carry Bearer.
        if request.method == "OPTIONS":
            return True

        path = request.url.path
        if path in self._public_paths:
            return True
        return path.startswith("/agents/")
