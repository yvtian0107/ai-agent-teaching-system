import { apiRequest } from "@/services/api";

export interface SessionSummaryDto {
  session_id: string;
  agent_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SessionMessageDto {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface SessionDetailDto {
  session_id: string;
  agent_id: string | null;
  title: string;
  messages: SessionMessageDto[];
  created_at: string;
  updated_at: string;
}

export interface SessionsListResponse {
  sessions: SessionSummaryDto[];
  total: number;
  page: number;
  limit: number;
}

export async function listSessions(params?: {
  page?: number;
  limit?: number;
  agentId?: string;
}) {
  const query = new URLSearchParams();
  if (params?.page) {
    query.set("page", String(params.page));
  }
  if (params?.limit) {
    query.set("limit", String(params.limit));
  }
  if (params?.agentId) {
    query.set("agent_id", params.agentId);
  }

  const path = query.size > 0 ? `/api/sessions?${query.toString()}` : "/api/sessions";
  return apiRequest<SessionsListResponse>(path);
}

export async function getSession(sessionId: string) {
  return apiRequest<SessionDetailDto>(`/api/sessions/${sessionId}`);
}

export async function deleteSession(sessionId: string) {
  return apiRequest<void>(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

export function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
