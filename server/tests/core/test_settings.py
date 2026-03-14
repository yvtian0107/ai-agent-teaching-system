from src.core.settings import settings


def test_settings_exposes_required_sections_and_keys():
    assert hasattr(settings, "supabase")
    assert hasattr(settings, "ollama")
    assert hasattr(settings, "database")

    assert hasattr(settings.supabase, "url")
    assert hasattr(settings.supabase, "anon_key")
    assert hasattr(settings.supabase, "service_key")
    assert hasattr(settings.supabase, "jwt_secret")

    assert hasattr(settings.ollama, "base_url")
    assert hasattr(settings.ollama, "default_model")
    assert hasattr(settings.ollama, "title_model")

    assert hasattr(settings.database, "path")
