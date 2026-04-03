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
  const setMessageFeedback = useKopilotStore((s) => s.setMessageFeedback)
  const reconstructThinkingGroups = useKopilotStore((s) => s.reconstructThinkingGroups)

  return async (sessionId: string) => {
    setActiveSessionId(sessionId)
    const data = await utils.kopilot.getSession.fetch({ sessionId })
    if (data?.messages) {
      const raw = data.messages as any[]

      // Build a lookup from toolCallId → { name, args } by scanning assistant message toolCalls
      const toolCallLookup = new Map<string, { name: string; args: Record<string, unknown> }>()
      for (const m of raw) {
        if (m.role === 'assistant' && m.toolCalls) {
          for (const tc of m.toolCalls) {
            let args: Record<string, unknown> = {}
            if (typeof tc.function?.arguments === 'string') {
              try {
                args = JSON.parse(tc.function.arguments)
              } catch {
                /* ignore */
              }
            } else if (tc.function?.arguments) {
              args = tc.function.arguments
            }
            toolCallLookup.set(tc.id, { name: tc.function?.name ?? 'unknown', args })
          }
        }
      }

      const messages = raw.map((m, i): KopilotMessage => {
        const id = m.toolCallId || `loaded-${i}`
        const msg: KopilotMessage = {
          id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
          parentId: m.parentId ?? (i > 0 ? raw[i - 1].toolCallId || `loaded-${i - 1}` : null),
          toolCalls: m.toolCalls,
        }

        // Reconstruct tool metadata for tool messages
        if (m.role === 'tool' && m.toolCallId) {
          const tc = toolCallLookup.get(m.toolCallId)
          if (tc) {
            let result: unknown
            if (m.content) {
              try {
                result = JSON.parse(m.content)
              } catch {
                result = m.content
              }
            }
            msg.tool = {
              name: tc.name,
              args: tc.args,
              result,
              status: 'completed',
            }
          }
        }

        return msg
      })
      setMessages(messages)
      reconstructThinkingGroups(messages)

      // Hydrate feedback from server
      const feedbackMap = await utils.kopilot.getSessionFeedback.fetch({ sessionId })
      for (const [messageId, isPositive] of Object.entries(feedbackMap)) {
        setMessageFeedback(messageId, isPositive)
      }
    }
  }
}
