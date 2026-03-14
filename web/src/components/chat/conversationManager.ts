'use client'

import { useSyncExternalStore } from 'react'
import type React from 'react'
import { apiRequest } from '@/services/api'
import { runAgentStream, readAguiStream } from '@/services/agent'
import type { RunAgentPayload } from '@/services/agent'
import type { AguiEvent } from '@/types/agui'
import type { AGUIMessage } from '@/components/chat/types'

export interface SessionState {
  messages: AGUIMessage[]
  messageMarkdown: Map<string, string>
  isAIRunning: boolean
  lastUpdated: number
}

interface StreamController {
  abort: () => void
  isRunning: boolean
  abortController?: AbortController
}

const NOTIFY_THROTTLE_MS = 50
const MAX_CACHED_SESSIONS = 10
const STREAM_IDLE_TIMEOUT_MS = 45_000

type RenderMarkdownFn = (text: string) => React.ReactNode
type AgentRole = 'student' | 'teacher' | 'admin' | 'all'

interface AgentDescriptor {
  id: string
}

interface AgentListResponse {
  agents: AgentDescriptor[]
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function normalizeRole(role?: string | null): AgentRole {
  if (role === 'student' || role === 'teacher' || role === 'admin') {
    return role
  }
  return 'all'
}

async function fetchAgentsByRole(role: AgentRole): Promise<AgentListResponse> {
  if (role === 'all') {
    return apiRequest<AgentListResponse>('/api/agents')
  }
  const query = new URLSearchParams({ role })
  return apiRequest<AgentListResponse>(`/api/agents?${query.toString()}`)
}

/** Resolve an agent id/path with optional role preference. */
async function resolveAgent(role?: string | null): Promise<{ id: string; path: string }> {
  const normalizedRole = normalizeRole(role)
  let data = await fetchAgentsByRole(normalizedRole)
  let first = data.agents[0]?.id

  // 角色过滤后无可用 agent 时，兜底回退到任意可用 agent。
  if (!first && normalizedRole !== 'all') {
    data = await fetchAgentsByRole('all')
    first = data.agents[0]?.id
  }

  if (!first) {
    throw new Error('未找到可用 agent，请先在后端启用 agent 配置')
  }
  return {
    id: first,
    path: `/agents/${first}/agui`,
  }
}

class ConversationManager {
  private sessions: Map<string, SessionState> = new Map()
  private streamControllers: Map<string, StreamController> = new Map()
  private listeners: Set<() => void> = new Set()
  private cachedAgentPathByRole: Map<AgentRole, string> = new Map()
  private cachedAgentIdByRole: Map<AgentRole, string> = new Map()

  private _notifyPending = false
  private _notifyTimer: ReturnType<typeof setTimeout> | null = null
  private _lastNotifyTime = 0

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private _doNotify(): void {
    this.listeners.forEach(l => l())
  }

  private notifyListeners(): void {
    const now = Date.now()
    const timeSinceLastNotify = now - this._lastNotifyTime

    if (timeSinceLastNotify >= NOTIFY_THROTTLE_MS) {
      this._lastNotifyTime = now
      this._notifyPending = false
      if (this._notifyTimer) {
        clearTimeout(this._notifyTimer)
        this._notifyTimer = null
      }
      this._doNotify()
      return
    }

    this._notifyPending = true
    if (!this._notifyTimer) {
      this._notifyTimer = setTimeout(() => {
        this._notifyTimer = null
        if (this._notifyPending) {
          this._notifyPending = false
          this._lastNotifyTime = Date.now()
          this._doNotify()
        }
      }, NOTIFY_THROTTLE_MS - timeSinceLastNotify)
    }
  }

  private notifyListenersImmediate(): void {
    this._notifyPending = false
    if (this._notifyTimer) {
      clearTimeout(this._notifyTimer)
      this._notifyTimer = null
    }
    this._lastNotifyTime = Date.now()
    this._doNotify()
  }

  initSession(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      const newState: SessionState = {
        messages: [],
        messageMarkdown: new Map(),
        isAIRunning: false,
        lastUpdated: Date.now(),
      }
      this.sessions.set(sessionId, newState)
      this.enforceSessionCacheLimit()
    }
    return this.sessions.get(sessionId)!
  }

  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  touchSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastUpdated = Date.now()
    this.enforceSessionCacheLimit()
  }

  setMessages(sessionId: string, messages: AGUIMessage[]): void {
    this.updateSession(sessionId, s => ({ ...s, messages }))
  }

  updateMessages(sessionId: string, updater: (messages: AGUIMessage[]) => AGUIMessage[], immediate = false): void {
    this.updateSession(
      sessionId,
      s => ({ ...s, messages: updater(s.messages) }),
      immediate
    )
  }

  private updateSession(sessionId: string, updater: (state: SessionState) => SessionState, immediate = false): void {
    const current = this.sessions.get(sessionId)
    if (!current) return
    const next = updater(current)
    next.lastUpdated = Date.now()
    this.sessions.set(sessionId, next)
    if (immediate) this.notifyListenersImmediate()
    else this.notifyListeners()
  }

  private isSessionProtected(state: SessionState): boolean {
    if (state.isAIRunning) return true
    return state.messages.some(
      m => m.status === 'loading' || (m.status === 'success' && m.runFinished !== true)
    )
  }

  private enforceSessionCacheLimit(): void {
    if (this.sessions.size <= MAX_CACHED_SESSIONS) return

    const evictable = [...this.sessions.entries()]
      .filter(([, state]) => !this.isSessionProtected(state))
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated)

    while (this.sessions.size > MAX_CACHED_SESSIONS && evictable.length > 0) {
      const [sessionId] = evictable.shift()!
      this.sessions.delete(sessionId)
      this.streamControllers.delete(sessionId)
    }
  }

  setAIRunning(sessionId: string, running: boolean): void {
    this.updateSession(sessionId, s => ({ ...s, isAIRunning: running }), true)
  }

  setMessageMarkdown(sessionId: string, msgId: string, markdown: string): void {
    const state = this.sessions.get(sessionId)
    if (state) state.messageMarkdown.set(msgId, markdown)
  }

  getMessageMarkdown(sessionId: string, msgId: string): string | undefined {
    return this.sessions.get(sessionId)?.messageMarkdown.get(msgId)
  }

  abortStream(sessionId: string): void {
    const controller = this.streamControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.streamControllers.delete(sessionId)
    }
  }

  async getAgentPath(role?: string | null): Promise<string> {
    const roleKey = normalizeRole(role)
    const cached = this.cachedAgentPathByRole.get(roleKey)
    if (cached) return cached

    const resolved = await resolveAgent(role)
    this.cachedAgentPathByRole.set(roleKey, resolved.path)
    this.cachedAgentIdByRole.set(roleKey, resolved.id)
    return resolved.path
  }

  async getAgentId(role?: string | null): Promise<string> {
    const roleKey = normalizeRole(role)
    const cached = this.cachedAgentIdByRole.get(roleKey)
    if (cached) return cached

    const resolved = await resolveAgent(role)
    this.cachedAgentPathByRole.set(roleKey, resolved.path)
    this.cachedAgentIdByRole.set(roleKey, resolved.id)
    return resolved.id
  }

  async startAIResponse(
    sessionId: string,
    userMessage: string,
    renderMarkdown: RenderMarkdownFn,
    errorMessage: string,
    addUserMessage = true,
    userId?: string,
    userRole?: string,
    onRunFinished?: () => void
  ): Promise<void> {
    this.initSession(sessionId)

    const userMessageTimestamp = Date.now()
    const userMsgId = `user-${userMessageTimestamp}`
    const aiMsgId = `ai-${userMessageTimestamp}`

    this.setAIRunning(sessionId, true)

    if (addUserMessage) {
      this.setMessageMarkdown(sessionId, userMsgId, userMessage)
      this.updateMessages(sessionId, prev => [
        ...prev,
        {
          id: userMsgId,
          message: renderMarkdown(userMessage),
          status: 'local',
          timestamp: userMessageTimestamp,
        },
        {
          id: aiMsgId,
          message: null,
          status: 'loading',
          runFinished: false,
          timestamp: Date.now(),
          userInput: userMessage,
        },
      ])
    } else {
      this.updateMessages(sessionId, prev => [
        ...prev,
        {
          id: aiMsgId,
          message: null,
          status: 'loading',
          runFinished: false,
          timestamp: Date.now(),
          userInput: userMessage,
        },
      ])
    }

    let aborted = false
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const controller: StreamController = {
      abort: () => {
        aborted = true
        abortController?.abort()
      },
      isRunning: true,
      abortController,
    }
    this.streamControllers.set(sessionId, controller)

    await this.handleAGUIEventStream(
      sessionId,
      userMessage,
      aiMsgId,
      renderMarkdown,
      errorMessage,
      () => aborted,
      () => abortController?.abort(),
      userId,
      userRole,
      onRunFinished,
      abortController?.signal
    )

    this.streamControllers.delete(sessionId)
  }

  private async handleAGUIEventStream(
    sessionId: string,
    userMessage: string,
    aiMsgId: string,
    _renderMarkdown: RenderMarkdownFn,
    errorMessage: string,
    isAborted: () => boolean,
    abortByWatchdog: () => void,
    userId?: string,
    userRole?: string,
    onRunFinished?: () => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    let messageAccumulated = ''
    let hasRunFinished = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let streamTimedOut = false

    const scheduleIdleTimeout = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (hasRunFinished || isAborted()) return
        streamTimedOut = true
        abortByWatchdog()
      }, STREAM_IDLE_TIMEOUT_MS)
    }

    const clearIdleTimeout = (): void => {
      if (!idleTimer) return
      clearTimeout(idleTimer)
      idleTimer = null
    }

    try {
      const agentPath = await this.getAgentPath(userRole)

      const payload: RunAgentPayload = {
        threadId: sessionId,
        runId: makeId(),
        parentRunId: null,
        state: {},
        messages: [{ role: 'user', id: makeId(), content: userMessage }],
        tools: [],
        context: [],
        forwardedProps: { user_id: userId ?? undefined },
      }

      const response = await runAgentStream(agentPath, payload)

      if (abortSignal?.aborted) {
        this.setAIRunning(sessionId, false)
        return
      }

      const eventStream = readAguiStream<AguiEvent>(response)
      scheduleIdleTimeout()

      for await (const event of eventStream) {
        scheduleIdleTimeout()
        if (isAborted()) {
          clearIdleTimeout()
          this.setAIRunning(sessionId, false)
          return
        }

        switch (event.type) {
          case 'TEXT_MESSAGE_CONTENT': {
            const e = event as { delta?: string; msg?: string }
            const textDelta = e.delta || e.msg || ''
            messageAccumulated += textDelta

            const currentText = messageAccumulated
            this.updateMessages(
              sessionId,
              prev => prev.map(msg => {
                if (msg.id !== aiMsgId) return msg
                return { ...msg, message: currentText, status: 'success' as const }
              })
            )
            break
          }

          case 'RUN_FINISHED':
            hasRunFinished = true
            this.setMessageMarkdown(sessionId, aiMsgId, messageAccumulated)
            this.updateMessages(
              sessionId,
              prev => prev.map(msg =>
                msg.id === aiMsgId
                  ? { ...msg, message: messageAccumulated, status: 'ended' as const, runFinished: true }
                  : msg
              ),
              true
            )
            this.setAIRunning(sessionId, false)
            onRunFinished?.()
            break

          case 'ERROR':
          case 'RUN_ERROR': {
            const e = event as { message?: string; error?: string }
            const errMsg = e.message ?? e.error ?? errorMessage
            this.updateMessages(
              sessionId,
              prev => prev.map(msg =>
                msg.id === aiMsgId
                  ? { ...msg, message: errMsg, status: 'ended' as const, runFinished: false }
                  : msg
              ),
              true
            )
            this.setAIRunning(sessionId, false)
            break
          }

          default:
            break
        }
      }

      clearIdleTimeout()

      if (!hasRunFinished && !isAborted()) {
        if (messageAccumulated) {
          this.setMessageMarkdown(sessionId, aiMsgId, messageAccumulated)
        }
        this.updateMessages(
          sessionId,
          prev => prev.map(msg => {
            if (msg.id !== aiMsgId) return msg
            if (msg.runFinished === true) return msg
            return {
              ...msg,
              message: messageAccumulated || msg.message,
              status: 'ended' as const,
              runFinished: false,
            }
          }),
          true
        )
        this.setAIRunning(sessionId, false)
      }
    } catch (error) {
      clearIdleTimeout()

      if (isAborted() && !streamTimedOut) {
        this.setAIRunning(sessionId, false)
        return
      }

      console.error('AG-UI stream error:', error)
      this.setAIRunning(sessionId, false)

      this.updateMessages(
        sessionId,
        prev => {
          const hasAiMsg = prev.some(m => m.id === aiMsgId)
          if (hasAiMsg) {
            return prev.map(m =>
              m.id === aiMsgId
                ? {
                    ...m,
                    message: streamTimedOut ? `${errorMessage} (连接超时)` : errorMessage,
                    status: 'ended' as const,
                    runFinished: false,
                  }
                : m
            )
          }
          return [
            ...prev,
            {
              id: aiMsgId,
              message: streamTimedOut ? `${errorMessage} (连接超时)` : errorMessage,
              status: 'ended' as const,
              runFinished: false,
              timestamp: Date.now(),
            },
          ]
        },
        true
      )
    }
  }
}

export const conversationManager = new ConversationManager()

export function useSessionState(sessionId: string): SessionState | undefined {
  return useSyncExternalStore(
    cb => conversationManager.subscribe(cb),
    () => conversationManager.getSessionState(sessionId),
    () => conversationManager.getSessionState(sessionId)
  )
}
