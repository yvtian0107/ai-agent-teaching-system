import json
import uuid

from fastapi.testclient import TestClient
from starlette.routing import Mount

from src.app import app


def _get_agui_path() -> str:
    for route in app.routes:
        if isinstance(route, Mount) and route.path.startswith("/agents/"):
            return f"{route.path}/agui"
    raise AssertionError("No mounted /agents/* app found")


def test_agui_rejects_invalid_body_with_422() -> None:
    with TestClient(app) as client:
        target = _get_agui_path()
        resp = client.post(
            target, json={"messages": [{"role": "user", "content": "hi"}]}
        )
    assert resp.status_code == 422


def test_agui_valid_body_returns_sse_events() -> None:
    payload = {
        "threadId": str(uuid.uuid4()),
        "runId": str(uuid.uuid4()),
        "parentRunId": None,
        "state": {},
        "messages": [
            {
                "role": "user",
                "id": str(uuid.uuid4()),
                "content": "请简短回复：你好",
            }
        ],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }

    with TestClient(app) as client:
        target = _get_agui_path()
        with client.stream("POST", target, json=payload) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")

            has_text = False
            has_finished = False
            for raw in resp.iter_lines():
                if not raw:
                    continue
                line = raw.decode() if isinstance(raw, bytes) else raw
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                event_type = event.get("type", "")
                if event_type.startswith("TEXT_MESSAGE_"):
                    has_text = True
                if event_type == "RUN_FINISHED":
                    has_finished = True
                    break

            assert has_text
            assert has_finished
