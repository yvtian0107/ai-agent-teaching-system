from fastapi import APIRouter
from urllib.parse import urlparse

from src.core.settings import settings

router = APIRouter(tags=["health"])


@router.get("/status")
async def status():
    """Health check endpoint."""
    auth_mode = (
        "jwt_secret"
        if settings.supabase.jwt_secret.strip()
        else "supabase_fallback"
    )
    supabase_host = urlparse(settings.supabase.url).netloc if settings.supabase.url else ""

    return {
        "status": "ok",
        "version": "0.1.0",
        "debug": settings.debug,
        "auth_mode": auth_mode,
        "supabase_host": supabase_host,
    }
