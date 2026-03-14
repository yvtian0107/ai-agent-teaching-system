"""Supabase 客户端封装"""

from supabase import create_client, Client

from src.core.settings import settings

_client: Client | None = None


def get_supabase_client() -> Client:
    """获取 Supabase 客户端单例（使用 service_key 访问，绕过 RLS）"""
    global _client
    if _client is None:
        _client = create_client(
            settings.supabase.url,
            settings.supabase.service_key,
        )
    return _client
