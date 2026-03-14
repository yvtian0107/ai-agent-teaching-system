'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Button, Skeleton, Modal, Spin } from 'antd'
import { PlusOutlined, LeftOutlined, RightOutlined, DeleteOutlined, LoadingOutlined, MessageOutlined } from '@ant-design/icons'
import ChatBox from '@/components/chat/ChatBox'
import type { ChatSession } from '@/components/chat/types'
import type { AGUIMessage } from '@/components/chat/types'
import { listSessions, getSession, deleteSession as deleteSessionApi } from '@/services/session'
import type { SessionSummaryDto } from '@/services/session'
import { conversationManager } from '@/components/chat/conversationManager'
import { buildSessionSections } from '@/components/chat/utils/sessionSections'
import { useAuthStore } from '@/store/authStore'

const SESSION_PAGE_SIZE = 20
const SESSION_LOAD_THRESHOLD = 160

function mapSessionResponse(sessions: SessionSummaryDto[]): ChatSession[] {
  return sessions.map((s) => ({
    id: s.session_id,
    title: s.title || '新会话',
    updatedAt: s.updated_at || s.created_at || '',
    agentId: s.agent_id ?? undefined,
  }))
}

function mergeSessionList(existing: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  if (incoming.length === 0) return existing
  const existingIds = new Set(existing.map(s => s.id))
  const appended = incoming.filter(s => !existingIds.has(s.id))
  return appended.length === 0 ? existing : [...existing, ...appended]
}

export default function ChatWorkspace() {
  const userId = useAuthStore((state) => state.user?.id)
  const userRole = useAuthStore((state) => state.user?.role)

  const studentGuide = '你好！我是你的 AI 学习助手。你可以让我讲解知识点、分层出题，或一步步提示你完成练习。'
  const teacherGuide = '你好！我是你的 AI 教学助手。你可以让我生成教案、设计分层练习，或根据课堂目标提供教学建议。'
  const guideText = useMemo(
    () => (userRole === 'teacher' || userRole === 'admin' ? teacherGuide : studentGuide),
    [userRole]
  )

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [sessionPage, setSessionPage] = useState(1)
  const [hasMoreSessions, setHasMoreSessions] = useState(false)
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [chatKey, setChatKey] = useState(0)

  const sessionsRef = useRef<ChatSession[]>([])
  const sessionListScrollRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreSessionsRef = useRef(false)
  const pendingRefreshSessionIdsRef = useRef<Set<string>>(new Set())

  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessionsRef.current || !hasMoreSessions || initializing || !activeAgentId) return

    loadingMoreSessionsRef.current = true
    setLoadingMoreSessions(true)

    const nextPage = sessionPage + 1
    try {
      const response = await listSessions({
        page: nextPage,
        limit: SESSION_PAGE_SIZE,
        agentId: activeAgentId,
      })
      const nextSessions = mapSessionResponse(response.sessions ?? [])
      const totalCount = response.total ?? 0

      if (nextSessions.length === 0) {
        setHasMoreSessions(false)
        return
      }

      const merged = mergeSessionList(sessionsRef.current, nextSessions)
      setSessions(merged)
      sessionsRef.current = merged
      setSessionPage(nextPage)
      if (totalCount > 0) {
        setHasMoreSessions(merged.length < totalCount)
      } else {
        setHasMoreSessions(nextSessions.length === SESSION_PAGE_SIZE)
      }
    } catch (error) {
      console.error('加载更多会话失败:', error)
    } finally {
      loadingMoreSessionsRef.current = false
      setLoadingMoreSessions(false)
    }
  }, [activeAgentId, hasMoreSessions, initializing, sessionPage])

  const handleSessionListScroll = useCallback(() => {
    const container = sessionListScrollRef.current
    if (!container) return

    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight)
    if (distanceToBottom <= SESSION_LOAD_THRESHOLD) {
      void loadMoreSessions()
    }
  }, [loadMoreSessions])

  const selectSession = async (sessionId: string) => {
    setSelectedSessionId(sessionId)
    setLoading(true)
    setChatKey(k => k + 1)
    conversationManager.touchSession(sessionId)

    const localSessionState = conversationManager.getSessionState(sessionId)
    const localMessages = localSessionState?.messages || []
    const hasCachedMessages = localMessages.length > 0
    const hasInProgressReply = localSessionState?.isAIRunning
      || localMessages.some(
        (m) => m.status === 'loading'
          || (m.status === 'success' && m.runFinished !== true)
      )

    if (hasCachedMessages || hasInProgressReply) {
      setLoading(false)
      return
    }

    try {
      const detail = await getSession(sessionId)
      const rawMessages = detail.messages ?? []

      const historyMessages: AGUIMessage[] = rawMessages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => {
          const msgId = `history-${msg.id}`
          const timestamp = Date.parse(msg.created_at) || Date.now()
          const content = msg.content ?? ''

          conversationManager.setMessageMarkdown(sessionId, msgId, content)

          if (msg.role === 'user') {
            return {
              id: msgId,
              message: content,
              status: 'local' as const,
              timestamp,
            }
          }

          return {
            id: msgId,
            message: content,
            status: 'history' as const,
            timestamp,
            runFinished: true,
          }
        })

      conversationManager.initSession(sessionId)
      conversationManager.setMessages(sessionId, historyMessages)
    } catch (error) {
      console.error('加载消息失败:', error)
      conversationManager.initSession(sessionId)
      conversationManager.setMessages(sessionId, [])
    } finally {
      setTimeout(() => setLoading(false), 300)
    }
  }

  const startNewChat = () => {
    const tempSessionId = `session_${Date.now()}`
    setSelectedSessionId(tempSessionId)
    conversationManager.initSession(tempSessionId)
    conversationManager.setMessages(tempSessionId, [])
    setChatKey(k => k + 1)
  }

  const refreshSessionsSilently = async () => {
    if (!activeAgentId) {
      return
    }

    try {
      const loadedLimit = Math.max(SESSION_PAGE_SIZE, sessionPage * SESSION_PAGE_SIZE)
      const response = await listSessions({ page: 1, limit: loadedLimit, agentId: activeAgentId })
      const sessionList = mapSessionResponse(response.sessions ?? [])
      const totalCount = response.total ?? sessionList.length
      setSessions(sessionList)
      sessionsRef.current = sessionList
      setSessionPage(Math.max(1, Math.ceil(sessionList.length / SESSION_PAGE_SIZE)))
      setHasMoreSessions(sessionList.length < totalCount)
    } catch (error) {
      console.error('静默刷新会话列表失败:', error)
    }
  }

  useEffect(() => {
    let cancelled = false

    setInitializing(true)
    setLoading(false)
    setSessions([])
    setActiveAgentId(null)
    sessionsRef.current = []
    setSessionPage(1)
    setHasMoreSessions(false)
    loadingMoreSessionsRef.current = false
    setLoadingMoreSessions(false)
    setSelectedSessionId(null)
    pendingRefreshSessionIdsRef.current.clear()
    setChatKey(k => k + 1)

    const init = async () => {
      try {
        const resolvedAgentId = await conversationManager.getAgentId(userRole)
        if (cancelled) return

        setActiveAgentId(resolvedAgentId)

        const response = await listSessions({
          page: 1,
          limit: SESSION_PAGE_SIZE,
          agentId: resolvedAgentId,
        })
        if (cancelled) return

        const sessionList = mapSessionResponse(response.sessions ?? [])
        const totalCount = response.total ?? sessionList.length

        setSessions(sessionList)
        sessionsRef.current = sessionList
        setSessionPage(1)
        setHasMoreSessions(sessionList.length < totalCount)

        // Start a fresh empty chat
        const tempId = `session_${Date.now()}`
        setSelectedSessionId(tempId)
        conversationManager.initSession(tempId)
        conversationManager.setMessages(tempId, [])
      } catch (e) {
        if (cancelled) return
        console.error('初始化失败:', e)
        const tempId = `session_${Date.now()}`
        setSelectedSessionId(tempId)
        conversationManager.initSession(tempId)
        conversationManager.setMessages(tempId, [])
      } finally {
        if (!cancelled) setInitializing(false)
      }
    }

    void init()
    return () => { cancelled = true }
  }, [userId, userRole])

  const handleNewChat = () => {
    startNewChat()
  }

  const handleSelectSession = (sessionId: string) => {
    void selectSession(sessionId)
  }

  const handleFirstMessage = (sessionId: string) => {
    if (sessionsRef.current.some(s => s.id === sessionId)) return
    const newSession: ChatSession = {
      id: sessionId,
      title: '新对话',
      updatedAt: new Date().toISOString(),
    }
    setSessions(prev => [newSession, ...prev])
    sessionsRef.current = [newSession, ...sessionsRef.current]
    pendingRefreshSessionIdsRef.current.add(sessionId)
  }

  const handleMessageSent = (sessionId: string) => {
    if (!sessionId) return
    const nextUpdatedAt = new Date().toISOString()

    const reorderWithUpdate = (list: ChatSession[]) => {
      const index = list.findIndex(item => item.id === sessionId)
      if (index < 0) return list
      const target = { ...list[index], updatedAt: nextUpdatedAt }
      const rest = list.filter(item => item.id !== sessionId)
      return [target, ...rest]
    }

    setSessions(prev => {
      const next = reorderWithUpdate(prev)
      sessionsRef.current = next
      return next
    })
  }

  const handleRunFinished = (sessionId: string) => {
    if (!sessionId) return
    if (pendingRefreshSessionIdsRef.current.has(sessionId)) {
      pendingRefreshSessionIdsRef.current.delete(sessionId)
    }
    void refreshSessionsSilently()
  }

  const handleDeleteSession = (sessionId: string, sessionTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除会话 "${sessionTitle}" 吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          await deleteSessionApi(sessionId)
          setSessions(prev => prev.filter(s => s.id !== sessionId))
          sessionsRef.current = sessionsRef.current.filter(s => s.id !== sessionId)
          if (selectedSessionId === sessionId) {
            startNewChat()
          }
        } catch (error) {
          console.error('删除会话失败:', error)
        }
      }
    })
  }

  const sessionSections = useMemo(() => {
    return buildSessionSections(sessions)
  }, [sessions])

  return (
    <div className="h-full">
      <div className="h-full flex overflow-hidden bg-[var(--color-bg-hover)]">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <div className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col relative">
            <div className="pr-4 pt-4 pb-3 border-b border-[var(--color-border)] flex-shrink-0">
              <Button
                type="primary"
                className="w-full"
                icon={<PlusOutlined />}
                onClick={handleNewChat}
                disabled={initializing}
              >
                新建对话
              </Button>
            </div>

            <div
              ref={sessionListScrollRef}
              onScroll={handleSessionListScroll}
              className="flex-1 overflow-y-auto min-h-0"
            >
              <div className="pr-4 pt-1">
                {initializing ? (
                  <div className="space-y-2 px-3 pt-2">
                    <Skeleton active paragraph={{ rows: 1 }} />
                    <Skeleton active paragraph={{ rows: 1 }} />
                    <Skeleton active paragraph={{ rows: 1 }} />
                  </div>
                ) : (
                  <>
                    {sessionSections.map((section) => (
                      <div key={section.label}>
                        <div className="text-xs text-[var(--color-text-3)] px-3 py-2">
                          {section.label}
                        </div>
                        <div className="space-y-3">
                          {section.items.map((session) => (
                            <div
                              key={session.id}
                              className={`group cursor-pointer rounded-lg transition-colors border ${selectedSessionId === session.id
                                ? 'bg-[var(--color-primary-bg-active)] hover:bg-[var(--color-primary-bg-active)] border-[var(--color-primary)]'
                                : 'hover:bg-[var(--color-bg-hover)] border-[var(--color-border)]'
                                }`}
                              onClick={() => handleSelectSession(session.id)}
                              style={{ padding: '10px 8px' }}
                            >
                              <div className="flex flex-col w-full gap-1">
                                <div className="flex items-center gap-1 w-full">
                                  <span className={`text-sm font-normal truncate flex-1 ${selectedSessionId === session.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-1)]'
                                    }`} title={session.title}>
                                    {session.title}
                                  </span>
                                  <Button
                                    type="text" size="small" danger
                                    icon={<DeleteOutlined />}
                                    className="!opacity-0 group-hover:!opacity-100 transition-opacity flex-shrink-0 !w-5 !h-5 !min-w-5 !p-0"
                                    onClick={(e) => handleDeleteSession(session.id, session.title, e)}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {sessions.length > 0 && (
                      <div className="py-2 text-center text-xs text-[var(--color-text-3)]">
                        {loadingMoreSessions
                          ? '加载中...'
                          : (!hasMoreSessions ? '没有更多了' : '')}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <Button
              type="text" icon={<LeftOutlined />}
              onClick={() => setSidebarCollapsed(true)}
              size="small"
              className="!absolute top-1/2 -right-3 -translate-y-1/2 z-50 !bg-[var(--color-bg-1)] border border-[var(--color-border)] !text-[var(--color-primary)]/80 !shadow-md !rounded-full !w-6 !h-6 !p-0 !min-w-6"
            />
          </div>
        )}

        {sidebarCollapsed && (
          <div className="w-2 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] relative">
            <Button
              type="text" icon={<RightOutlined />}
              onClick={() => setSidebarCollapsed(false)}
              size="small"
              className="!absolute top-1/2 -right-3 -translate-y-1/2 z-50 !bg-[var(--color-bg-1)] border border-[var(--color-border)] !text-[var(--color-primary)]/80 !shadow-md !rounded-full !w-6 !h-6 !p-0 !min-w-6"
            />
          </div>
        )}

        {/* Main area */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <div className="flex-1 min-h-0">
            {initializing || loading ? (
              <div className="w-full h-full flex justify-center items-center pt-8 px-6 bg-[var(--color-bg-1)]">
                <Spin indicator={<LoadingOutlined spin />} size='large' />
              </div>
            ) : selectedSessionId ? (
              <ChatBox
                key={chatKey}
                sessionId={selectedSessionId}
                placeholder="输入消息，按 Enter 发送..."
                guide={guideText}
                onFirstMessage={handleFirstMessage}
                onMessageSent={handleMessageSent}
                onRunFinished={handleRunFinished}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[var(--color-bg-1)]">
                <div className="text-center">
                  <MessageOutlined className="text-6xl text-[var(--color-text-4)] mb-4" />
                  <p className="text-[var(--color-text-3)]">点击新建对话开始学习</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
