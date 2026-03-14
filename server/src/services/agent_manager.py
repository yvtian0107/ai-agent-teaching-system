"""Agent 管理器

启动时从 Supabase 加载所有 enabled 的 agent 配置，
构建并挂载到主 FastAPI 应用上。
"""

from typing import Optional

from fastapi import FastAPI
from loguru import logger

from src.core.supabase_client import get_supabase_client
from src.services.agent_builder import build_agent, build_agent_os


class AgentManager:
    def __init__(self):
        self._instances: dict[str, object] = {}  # agent_id -> AgentOS
        self._configs: dict[str, dict] = {}  # agent_id -> config
        self._app: Optional[FastAPI] = None

    async def initialize(self, app: FastAPI) -> None:
        """启动时加载所有 enabled 的 agents"""
        self._app = app

        try:
            configs = self._fetch_enabled_agents()
        except Exception as e:
            logger.error(f"从 Supabase 加载 agent 配置失败: {e}")
            configs = []

        for config in configs:
            try:
                self._build_and_mount(config)
            except Exception as e:
                logger.error(f"Agent {config.get('id')} 构建失败: {e}")

        logger.info(f"AgentManager 初始化完成: {len(self._instances)} 个 agent 已加载")

    def _fetch_enabled_agents(self) -> list[dict]:
        """从 Supabase agents 表查询所有 enabled 的 agent"""
        client = get_supabase_client()
        response = client.table("agents").select("*").eq("status", "enabled").execute()
        return response.data or []

    def _build_and_mount(self, config: dict) -> None:
        """构建 agent 并挂载到 FastAPI"""
        agent_id = config["id"]
        if agent_id in self._instances:
            return

        # 归一化 target_role，避免前端过滤时出现脏值。
        normalized_config = {
            **config,
            "target_role": self._normalize_target_role(config.get("target_role")),
        }

        agent = build_agent(normalized_config)
        agent_os = build_agent_os(agent)

        self._instances[agent_id] = agent_os
        self._configs[agent_id] = normalized_config

        if self._app:
            self._app.mount(f"/agents/{agent_id}", agent_os.get_app())
            logger.info(f"Agent 已挂载: /agents/{agent_id}/agui")

    def get_agent_ids(self) -> list[str]:
        return [item["id"] for item in self.get_agents()]

    def get_agents(self, role: str | None = None) -> list[dict]:
        """返回可用 agent 列表，可选按角色过滤。"""
        role_filter = role if role in {"student", "teacher"} else None

        agents: list[dict] = []
        for agent_id, config in self._configs.items():
            target_role = self._normalize_target_role(config.get("target_role"))
            if role_filter and target_role not in {"all", role_filter}:
                continue

            agents.append(
                {
                    "id": agent_id,
                    "name": config.get("name", "Teaching Assistant"),
                    "description": config.get("description"),
                    "target_role": target_role,
                }
            )

        return agents

    def is_loaded(self, agent_id: str) -> bool:
        return agent_id in self._instances

    def _normalize_target_role(self, raw_role: object) -> str:
        if raw_role in {"student", "teacher", "all"}:
            return str(raw_role)
        return "all"


_manager: AgentManager | None = None


def get_agent_manager() -> AgentManager:
    global _manager
    if _manager is None:
        _manager = AgentManager()
    return _manager
