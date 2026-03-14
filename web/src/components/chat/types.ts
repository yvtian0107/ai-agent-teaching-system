import type React from 'react'

export interface ChatSession {
  id: string
  title: string
  updatedAt: string
  agentId?: string
}

export interface ChatBoxProps {
  sessionId: string
  botId?: string
  placeholder?: string
  guide?: string
  errorMessage?: string
  inputDisabled?: boolean
  disabledReason?: string
  onFirstMessage?: (sessionId: string) => void
  onMessageSent?: (sessionId: string) => void
  onRunFinished?: (sessionId: string) => void
}

export interface AGUIMessage {
  id: string
  message: string | React.ReactNode | null
  status: 'local' | 'ai' | 'loading' | 'success' | 'ended' | 'history'
  timestamp: number
  runFinished?: boolean
  userInput?: string
}
