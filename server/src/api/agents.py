from typing import Literal

from fastapi import APIRouter, Query

from src.services.agent_manager import get_agent_manager

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("")
async def list_agents(
    role: Literal["student", "teacher", "admin"] | None = Query(default=None),
) -> dict:
    manager = get_agent_manager()
    agents = manager.get_agents(role=role)
    return {
        "agents": agents,
        "total": len(agents),
    }
