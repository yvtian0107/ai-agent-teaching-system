'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { Button, App } from 'antd'
import { Bubble, Sender } from '@ant-design/x'
import { CopyOutlined } from '@ant-design/icons'
import type { ChatBoxProps } from './types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { conversationManager, useSessionState } from '@/components/chat/conversationManager'
import type { AGUIMessage } from '@/components/chat/types'
import { useAuthStore } from '@/store/authStore'

const MAX_MARKDOWN_CACHE_ENTRIES = 120

interface ChatMessageItemProps {
  msg: AGUIMessage
  sessionId: string
  renderMarkdown: (content: string, cacheKey?: string, cacheable?: boolean) => React.ReactNode
  getCopyText: (msgId: string, fallback?: string) => string
  onCopy: (text: string) => void
}

const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  renderMarkdown,
  getCopyText,
  onCopy,
}: ChatMessageItemProps) {
  const shouldShowLoading = msg.status === 'loading'

  return (
    <div
      className="group"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '0 160px',
      }}
    >
      <Bubble
        placement={msg.status === 'local' ? 'end' : 'start'}
        variant={msg.status === 'local' ? 'filled' : 'borderless'}
        shape="round"
        loading={shouldShowLoading}
        content={typeof msg.message === 'string' ? msg.message : ''}
        contentRender={() => {
          if (msg.status === 'local') {
            const text = getCopyText(msg.id, typeof msg.message === 'string' ? msg.message : '')
            return <div className="whitespace-pre-wrap break-words">{text}</div>
          }

          const fallback = typeof msg.message === 'string' ? msg.message : ''
          return fallback
            ? renderMarkdown(fallback, undefined, msg.runFinished === true || msg.status === 'history')
            : null
        }}
        footer={() => {
          if (msg.status === 'local') return null
          if (msg.runFinished !== true) return null
          return (
            <div className="flex gap-0.5 justify-end">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined style={{ color: 'var(--color-text-2)' }} />}
                onClick={() => onCopy(getCopyText(msg.id, typeof msg.message === 'string' ? msg.message : ''))}
                className="!w-6 !h-6 !p-0"
              />
            </div>
          )
        }}
      />
    </div>
  )
}, (prev, next) => {
  return prev.msg === next.msg && prev.sessionId === next.sessionId
})

export default function ChatBox({
  sessionId,
  placeholder,
  guide,
  errorMessage,
  inputDisabled = false,
  disabledReason,
  onFirstMessage,
  onMessageSent,
  onRunFinished,
}: ChatBoxProps) {
  const { message } = App.useApp()
  const [inputValue, setInputValue] = useState('')
  const chatContentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const markdownCacheRef = useRef<Map<string, React.ReactNode>>(new Map())
  const isNearBottomRef = useRef(true)
  const forcedFollowSessionIdRef = useRef<string | null>(null)
  const user = useAuthStore((state) => state.user)
  const sessionState = useSessionState(sessionId)
  const messages = useMemo(() => sessionState?.messages ?? [], [sessionState?.messages])
  const isAIRunning = sessionState?.isAIRunning ?? false

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (chatContentRef.current) {
      chatContentRef.current.scrollTo({
        top: chatContentRef.current.scrollHeight,
        behavior,
      })
    }
  }, [])

  const updateNearBottomState = useCallback(() => {
    const container = chatContentRef.current
    if (!container) return
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight)
    isNearBottomRef.current = distanceToBottom <= 120
  }, [])

  const lastMessageId = messages[messages.length - 1]?.id
  const hasHistoryMessages = useMemo(
    () => messages.some((m) => m.status === 'history'),
    [messages]
  )

  useEffect(() => {
    if (messages.length === 0) return

    if (hasHistoryMessages && !isAIRunning) {
      requestAnimationFrame(() => scrollToBottom('auto'))
      const timer1 = setTimeout(() => scrollToBottom('auto'), 80)
      const timer2 = setTimeout(() => scrollToBottom('auto'), 220)
      isNearBottomRef.current = true
      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }

    requestAnimationFrame(() => scrollToBottom('smooth'))
    return undefined
  }, [sessionId, lastMessageId, messages.length, hasHistoryMessages, isAIRunning, scrollToBottom])

  useEffect(() => {
    if (!isAIRunning) return
    if (messages.length === 0) return
    if (forcedFollowSessionIdRef.current === sessionId) return

    forcedFollowSessionIdRef.current = sessionId
    isNearBottomRef.current = true

    requestAnimationFrame(() => scrollToBottom('auto'))
    const timer1 = setTimeout(() => scrollToBottom('auto'), 80)
    const timer2 = setTimeout(() => scrollToBottom('auto'), 220)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
    }
  }, [sessionId, isAIRunning, messages.length, scrollToBottom])

  useEffect(() => {
    if (!isAIRunning) return
    if (messages.length === 0) return
    if (!isNearBottomRef.current) return
    requestAnimationFrame(() => scrollToBottom('auto'))
  }, [messages, isAIRunning, scrollToBottom])

  useEffect(() => {
    const container = chatContentRef.current
    if (!container) return

    const onScroll = () => updateNearBottomState()
    container.addEventListener('scroll', onScroll, { passive: true })
    updateNearBottomState()

    return () => {
      container.removeEventListener('scroll', onScroll)
    }
  }, [sessionId, updateNearBottomState])

  useEffect(() => {
    markdownCacheRef.current.clear()
    forcedFollowSessionIdRef.current = null
    isNearBottomRef.current = true
  }, [sessionId])

  const renderMarkdownRaw = useCallback((content: string) => (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) {
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <SyntaxHighlighter style={tomorrow} language={match[1]} PreTag="div" {...props}>
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  ), [])

  const renderMarkdown = useCallback((content: string, cacheKey?: string, cacheable = false) => {
    if (!cacheable) {
      return renderMarkdownRaw(content)
    }

    const key = cacheKey || content
    const cache = markdownCacheRef.current
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }

    const rendered = renderMarkdownRaw(content)
    cache.set(key, rendered)

    if (cache.size > MAX_MARKDOWN_CACHE_ENTRIES) {
      const firstKey = cache.keys().next().value
      if (typeof firstKey === 'string') {
        cache.delete(firstKey)
      }
    }

    return rendered
  }, [renderMarkdownRaw])

  const submitMessage = useCallback(
    async (rawMessage: string) => {
      const trimmed = rawMessage.trim()
      if (!trimmed) return
      if (inputDisabled) {
        message.warning(disabledReason || '输入已禁用')
        return
      }
      if (isAIRunning) return

      if (messages.length === 0 && onFirstMessage) {
        onFirstMessage(sessionId)
      }

      onMessageSent?.(sessionId)

      try {
        await conversationManager.startAIResponse(
          sessionId,
          trimmed,
          (text) => renderMarkdown(text),
          errorMessage || '回复出错，请重试',
          true,
          user?.id,
          user?.role,
          () => onRunFinished?.(sessionId)
        )
      } finally {
        inputRef.current?.focus?.()
      }
    },
    [
      disabledReason,
      errorMessage,
      inputDisabled,
      isAIRunning,
      message,
      messages.length,
      onFirstMessage,
      onMessageSent,
      onRunFinished,
      renderMarkdown,
      sessionId,
      user?.id,
      user?.role,
    ]
  )

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      message.success('复制成功')
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = content
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      message.success('复制成功')
    }
  }

  const parseGuide = (guideText: string) => {
    if (!guideText) return null

    return (
      <div className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-bg-hover)] p-3 text-sm text-[var(--color-text-2)]">
        {guideText}
      </div>
    )
  }

  const getCopyText = useCallback(
    (msgId: string, fallback?: string) => {
      const stored = conversationManager.getMessageMarkdown(sessionId, msgId)
      return stored ?? fallback ?? ''
    },
    [sessionId]
  )

  const handleCancel = useCallback(() => {
    conversationManager.abortStream(sessionId)
    conversationManager.setAIRunning(sessionId, false)
    conversationManager.updateMessages(
      sessionId,
      prev => {
        const idx = [...prev].reverse().findIndex(m => m.status === 'loading' || m.status === 'success')
        if (idx < 0) return prev
        const realIndex = prev.length - 1 - idx
        return prev.map((m, i) => (i === realIndex ? { ...m, status: 'ended' as const } : m))
      },
      true
    )
  }, [sessionId])

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-1)]">
      {/* Message list */}
      <div
        ref={chatContentRef}
        className="flex-1 overflow-y-auto p-6"
        style={{ minHeight: 0 }}
      >
        {guide && messages.length === 0 && parseGuide(guide)}

        <div className="space-y-3">
          {messages.map(msg => (
            <ChatMessageItem
              key={msg.id}
              msg={msg}
              sessionId={sessionId}
              renderMarkdown={renderMarkdown}
              getCopyText={getCopyText}
              onCopy={handleCopy}
            />
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border)] p-4">
        {inputDisabled && (
          <div className="mb-3 rounded border border-[var(--color-warning)] bg-amber-50 px-3 py-2 text-sm text-[var(--color-warning)]">
            {disabledReason || '当前无法发送消息'}
          </div>
        )}
        <Sender
          value={inputValue}
          onChange={(val) => setInputValue(val)}
          disabled={inputDisabled}
          loading={isAIRunning}
          placeholder={inputDisabled ? disabledReason || '当前无法发送消息' : placeholder || '输入消息，按 Enter 发送...'}
          submitType="enter"
          autoSize={{ minRows: 1, maxRows: 4 }}
          classNames={{
            input: '!border-0 !shadow-none !bg-transparent',
            content: '!bg-transparent',
          }}
          styles={{
            input: { border: 'none', boxShadow: 'none' },
          }}
          onSubmit={(msg: string) => {
            if (inputDisabled) return
            setInputValue('')
            submitMessage(msg)
          }}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}
