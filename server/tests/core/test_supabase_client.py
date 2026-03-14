from src.core import supabase_client


class _FakeClient:
    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key


def test_get_supabase_client_returns_singleton(monkeypatch):
    original_client = supabase_client._client
    supabase_client._client = None

    def _fake_create_client(url: str, key: str):
        return _FakeClient(url, key)

    monkeypatch.setattr(supabase_client, "create_client", _fake_create_client)

    try:
        first = supabase_client.get_supabase_client()
        second = supabase_client.get_supabase_client()

        assert first is second
    finally:
        supabase_client._client = original_client
