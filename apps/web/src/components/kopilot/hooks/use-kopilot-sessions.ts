// apps/web/src/components/kopilot/hooks/use-kopilot-sessions.ts

import type { SelectOption } from '@auxx/types/custom-field'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { ContentPart, KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'

/**
 * Shared input for the listSessions query — used by the hook AND any code
 * that patches the cache directly (e.g. the SSE handler). Keep these in lockstep
 * or cache patches will silently miss.
 */
export const KOPILOT_SESSIONS_QUERY_INPUT = { limit: 50 } as const

export function useKopilotSessions() {
  const sessions = api.kopilot.listSessions.useQuery(KOPILOT_SESSIONS_QUERY_INPUT, {
    staleTime: 30_000,
  })
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
 * Persisted message shape — already in the parts-based content-block model.
 * Projects directly onto KopilotMessage with no synthesis or reconstruction:
 * assistant messages carry `parts[]`; user/system messages carry `content`;
 * approval cards are their own system messages with `approval` data.
 */
interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  parts?: ContentPart[]
  timestamp?: number
  parentId?: string | null
  metadata?: Record<string, unknown>
  approval?: KopilotMessage['approval']
  linkSnapshots?: KopilotMessage['linkSnapshots']
  error?: string
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
  const setSelectedModelId = useKopilotStore((s) => s.setSelectedModelId)

  return async (sessionId: string) => {
    setActiveSessionId(sessionId)
    const data = await utils.kopilot.getSession.fetch({ sessionId })

    // Restore model picker to the session's last-used model
    setSelectedModelId((data as any)?.modelId ?? null)

    if (data?.messages) {
      const raw = data.messages as PersistedMessage[]

      // Persisted shape == render-ready shape. No filter, no reparent loop,
      // no _pendingToolCall re-emit, no reconstructThinkingGroups.
      const hydrated: KopilotMessage[] = raw.map((m, i) => ({
        id: m.id,
        role: m.role,
        ...(m.content !== undefined ? { content: m.content } : {}),
        ...(m.parts ? { parts: m.parts } : {}),
        timestamp: m.timestamp ?? Date.now(),
        parentId: m.parentId ?? (i > 0 ? (raw[i - 1]!.id ?? null) : null),
        metadata: m.metadata as KopilotMessage['metadata'],
        ...(m.approval ? { approval: m.approval } : {}),
        ...(m.linkSnapshots ? { linkSnapshots: m.linkSnapshots } : {}),
        ...(m.error ? { error: m.error } : {}),
      }))

      setMessages(hydrated)

      // Hydrate feedback from server
      const feedbackMap = await utils.kopilot.getSessionFeedback.fetch({ sessionId })
      for (const [messageId, isPositive] of Object.entries(feedbackMap)) {
        setMessageFeedback(messageId, isPositive)
      }
    }
  }
}
