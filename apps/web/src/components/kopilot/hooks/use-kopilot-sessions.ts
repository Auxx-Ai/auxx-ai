// apps/web/src/components/kopilot/hooks/use-kopilot-sessions.ts

import type { SelectOption } from '@auxx/types/custom-field'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'

export function useKopilotSessions() {
  const sessions = api.kopilot.listSessions.useQuery({ limit: 50 }, { staleTime: 30_000 })
  const utils = api.useUtils()

  const deleteSession = api.kopilot.deleteSession.useMutation({
    onSuccess: () => utils.kopilot.listSessions.invalidate(),
  })

  const updateTitle = api.kopilot.updateTitle.useMutation({
    onSuccess: () => utils.kopilot.listSessions.invalidate(),
  })

  const sessionOptions: SelectOption[] = useMemo(
    () =>
      (sessions.data?.items ?? []).map((s) => ({
        value: s.id,
        label: s.title || `Session ${s.id.slice(0, 6)}`,
      })),
    [sessions.data]
  )

  return {
    sessions,
    sessionOptions,
    isLoading: sessions.isLoading,
    deleteSession,
    updateTitle,
  }
}

/**
 * Load a session's messages into the kopilot store.
 * Returns a stable callback that fetches the session and sets messages.
 */
export function useLoadSession() {
  const utils = api.useUtils()
  const setMessages = useKopilotStore((s) => s.setMessages)
  const setActiveSessionId = useKopilotStore((s) => s.setActiveSessionId)

  return async (sessionId: string) => {
    setActiveSessionId(sessionId)
    const data = await utils.kopilot.getSession.fetch({ sessionId })
    if (data?.messages) {
      const raw = data.messages as any[]
      const messages = raw.map((m, i): KopilotMessage => {
        const id = m.toolCallId || `loaded-${i}`
        return {
          id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
          parentId: m.parentId ?? (i > 0 ? raw[i - 1].toolCallId || `loaded-${i - 1}` : null),
          toolCalls: m.toolCalls,
        }
      })
      setMessages(messages)
    }
  }
}
