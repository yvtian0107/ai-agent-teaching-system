"""Session API 路由

照搬 imitate_server 的鉴权模式：通过 AuthMiddleware 注入的 request.state.user_id
获取当前用户，未认证则 401。
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from src.services.session_service import SessionService, SessionNotFoundError

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


async def get_current_user_id(request: Request) -> str:
    """从 AuthMiddleware 注入的 request.state 中提取 user_id。

    imitate_server 在 dependencies.py 中做类似的事情，
    这里简化为只提取 user_id，因为本系统没有 tenant 概念。
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return str(user_id)

    # 兼容 auth middleware 将完整 payload 放在 request.state.user 的情况
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        uid = user.get("sub") or user.get("user_id") or user.get("id")
        if uid:
            return str(uid)

    raise HTTPException(status_code=401, detail="Not authenticated")


@router.get("")
async def list_sessions(
    user_id: str = Depends(get_current_user_id),
    agent_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """获取用户的会话列表"""
    service = SessionService(user_id=user_id)
    sessions, total = service.list_sessions(page=page, limit=limit, agent_id=agent_id)
    return {"sessions": sessions, "total": total, "page": page, "limit": limit}


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """获取会话详情（含消息）"""
    service = SessionService(user_id=user_id)
    try:
        return service.get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除会话"""
    service = SessionService(user_id=user_id)
    service.delete_session(session_id)
