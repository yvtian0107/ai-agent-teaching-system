from fastapi.testclient import TestClient

from src.app import app


def test_list_agents_is_public_and_returns_shape() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/agents")

    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "total" in data
    assert isinstance(data["agents"], list)
    assert isinstance(data["total"], int)
