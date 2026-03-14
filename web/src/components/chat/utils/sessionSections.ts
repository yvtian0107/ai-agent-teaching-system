import type { ChatSession } from '@/components/chat/types'

export interface SessionSection {
  label: string
  items: ChatSession[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseTimestamp(value: string): number {
  if (!value) return 0

  if (/^\d+$/.test(value)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    return value.length <= 10 ? numeric * 1000 : numeric
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function buildSessionSections(sessions: ChatSession[]): SessionSection[] {
  const sortedSessions = [...sessions].sort(
    (a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt)
  )

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - DAY_MS
  const last7DaysStart = todayStart - 7 * DAY_MS

  const today: ChatSession[] = []
  const yesterday: ChatSession[] = []
  const last7Days: ChatSession[] = []
  const monthlyGroups = new Map<string, ChatSession[]>()

  sortedSessions.forEach((session) => {
    const timestamp = parseTimestamp(session.updatedAt)

    if (timestamp >= todayStart) {
      today.push(session)
      return
    }

    if (timestamp >= yesterdayStart) {
      yesterday.push(session)
      return
    }

    if (timestamp >= last7DaysStart) {
      last7Days.push(session)
      return
    }

    const date = timestamp > 0 ? new Date(timestamp) : new Date(0)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const groupKey = `${year}-${month}`

    if (!monthlyGroups.has(groupKey)) {
      monthlyGroups.set(groupKey, [])
    }
    monthlyGroups.get(groupKey)!.push(session)
  })

  const sections: SessionSection[] = []
  if (today.length > 0) {
    sections.push({ label: '今天', items: today })
  }
  if (yesterday.length > 0) {
    sections.push({ label: '昨天', items: yesterday })
  }
  if (last7Days.length > 0) {
    sections.push({ label: '最近 7 天', items: last7Days })
  }

  Array.from(monthlyGroups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([label, items]) => {
      sections.push({ label, items })
    })

  return sections
}
