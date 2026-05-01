// apps/web/src/components/kopilot/hooks/use-kopilot-sessions.ts

import type { SelectOption } from '@auxx/types/custom-field'
import { generateId } from '@auxx/utils/generateId'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { KopilotMessage } from '../stores/kopilot-store'
import { isExecutorAssistant, useKopilotStore } from '../stores/kopilot-store'

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
 * Load a session's messages into the kopilot store.
 * Returns a stable callback that fetches the session and sets messages.
 */
export function useLoadSession() {
  const utils = api.useUtils()
  const setMessages = useKopilotStore((s) => s.setMessages)
  const setActiveSessionId = useKopilotStore((s) => s.setActiveSessionId)
  const setMessageFeedback = useKopilotStore((s) => s.setMessageFeedback)
  const setSelectedModelId = useKopilotStore((s) => s.setSelectedModelId)
  const reconstructThinkingGroups = useKopilotStore((s) => s.reconstructThinkingGroups)

  return async (sessionId: string) => {
    setActiveSessionId(sessionId)
    const data = await utils.kopilot.getSession.fetch({ sessionId })

    // Restore model picker to the session's last-used model
    setSelectedModelId((data as any)?.modelId ?? null)

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

      const messages = raw.flatMap((m, i): KopilotMessage[] => {
        const id = m.toolCallId || `loaded-${i}`
        const msg: KopilotMessage = {
          id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
          parentId: m.parentId ?? (i > 0 ? raw[i - 1].toolCallId || `loaded-${i - 1}` : null),
          metadata: m.metadata,
          toolCalls: m.toolCalls,
          ...(m.linkSnapshots ? { linkSnapshots: m.linkSnapshots } : {}),
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
            const status: 'running' | 'completed' | 'error' =
              m.toolStatus === 'error'
                ? 'error'
                : m.toolStatus === 'rejected'
                  ? 'completed'
                  : 'completed'
            msg.tool = {
              name: tc.name,
              callId: m.toolCallId,
              args: tc.args,
              result,
              digest: m.digest,
              status,
            }
          }
        }

        return [msg]
      })
      // Split: visible messages go to the store, all messages go to reconstruction.
      // After filtering out executor assistant messages, reparent so the chain
      // stays contiguous — each visible message's parent is the previous visible message.
      const visibleMessages = messages.filter((m) => !isExecutorAssistant(m))

      // Reconstruct the pending-approval state from persisted domainState. The
      // engine no longer stores the assistant-with-tool_calls message in
      // messages[] while paused (kept on _pendingToolCall.assistantMessage so
      // the persisted array is always provider-valid), so we re-emit the
      // assistant bubble here, followed by the approval card.
      const domainState = (data as any).domainState as Record<string, unknown> | undefined
      if (domainState?._waitingForApproval && domainState?._pendingToolCall) {
        const ptc = domainState._pendingToolCall as {
          toolCallId: string
          toolName: string
          agentName: string
          args: Record<string, unknown>
          assistantMessage?: {
            content?: string
            toolCalls?: unknown[]
            reasoning_content?: string
            timestamp?: number
            metadata?: Record<string, unknown>
          }
        }

        if (ptc.assistantMessage) {
          const am = ptc.assistantMessage
          const assistantBubble: KopilotMessage = {
            id: generateId(),
            role: 'assistant',
            content: am.content ?? '',
            timestamp: am.timestamp ?? Date.now(),
            parentId:
              visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1]!.id : null,
            metadata: am.metadata,
            toolCalls: am.toolCalls as KopilotMessage['toolCalls'],
          }
          if (!isExecutorAssistant(assistantBubble)) {
            visibleMessages.push(assistantBubble)
          }
        }

        visibleMessages.push({
          id: generateId(),
          role: 'system',
          content: `Approval needed: ${ptc.toolName}`,
          timestamp: Date.now(),
          parentId:
            visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1]!.id : null,
          approval: {
            toolName: ptc.toolName,
            toolCallId: ptc.toolCallId,
            args: ptc.args ?? {},
            status: 'pending',
          },
        })
      }

      for (let i = 0; i < visibleMessages.length; i++) {
        visibleMessages[i] = {
          ...visibleMessages[i]!,
          parentId: i > 0 ? visibleMessages[i - 1]!.id : null,
        }
      }
      setMessages(visibleMessages)
      reconstructThinkingGroups(messages)

      // Hydrate feedback from server
      const feedbackMap = await utils.kopilot.getSessionFeedback.fetch({ sessionId })
      for (const [messageId, isPositive] of Object.entries(feedbackMap)) {
        setMessageFeedback(messageId, isPositive)
      }
    }
  }
}
