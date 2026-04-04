// apps/web/src/components/kopilot/ui/kopilot-chat.tsx

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLoadSession } from '../hooks/use-kopilot-sessions'
import { type KopilotRequest, useKopilotSSE } from '../hooks/use-kopilot-sse'
import { useKopilotStore } from '../stores/kopilot-store'
import './blocks/register-blocks'
import { api } from '~/trpc/react'
import { KopilotComposer, type KopilotComposerHandle } from './kopilot-composer'
import { KopilotMessageList } from './kopilot-message-list'
import { KopilotStatusBar } from './kopilot-status-bar'

export interface KopilotChatProps {
  /** Current page context (e.g. 'mail', 'kopilot') */
  page: string
  /** Page-specific context */
  context?: Record<string, unknown>
  /** Called when user switches sessions. Panel: updates store. Page: router.push. */
  onSessionChange?: (sessionId: string | null) => void
  /** Initial session to load on mount */
  initialSessionId?: string | null
  /** Class applied to inner content areas (message list, composer) for centering/width constraints */
  contentClassName?: string
}

export function KopilotChat({
  page,
  context,
  onSessionChange,
  initialSessionId,
  contentClassName,
}: KopilotChatProps) {
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)
  const messages = useKopilotStore((s) => s.messages)
  const setMessageFeedback = useKopilotStore((s) => s.setMessageFeedback)
  const addMessage = useKopilotStore((s) => s.addMessage)

  const composerRef = useRef<KopilotComposerHandle>(null)
  const [pendingRequest, setPendingRequest] = useState<KopilotRequest | null>(null)

  // SSE hook
  useKopilotSSE({
    pendingRequest,
    onRequestSent: () => setPendingRequest(null),
  })

  // Session loading
  const loadSession = useLoadSession()

  // Load initial session on mount
  const hasLoadedInitialRef = useRef(false)
  useEffect(() => {
    if (hasLoadedInitialRef.current) return

    // If an explicit initialSessionId is provided, load it
    if (initialSessionId) {
      hasLoadedInitialRef.current = true
      loadSession(initialSessionId)
      return
    }

    // Otherwise, load persisted session if messages are empty
    if (activeSessionId && messages.length === 0) {
      hasLoadedInitialRef.current = true
      loadSession(activeSessionId)
    }
  }, [initialSessionId, activeSessionId, messages.length, loadSession])

  // Feedback
  const rateMessage = api.kopilot.rateMessage.useMutation()

  const handleFeedback = useCallback(
    (messageId: string, isPositive: boolean) => {
      if (!activeSessionId) return

      const current = messageMap[messageId]?.feedback?.isPositive
      const newValue = current === isPositive ? null : isPositive

      setMessageFeedback(messageId, newValue)

      rateMessage.mutate({
        sessionId: activeSessionId,
        messageId,
        isPositive,
      })
    },
    [activeSessionId, messageMap, setMessageFeedback, rateMessage]
  )

  const handleSend = useCallback((request: KopilotRequest) => {
    setPendingRequest(request)
  }, [])

  const handleSuggestionClick = useCallback(
    (text: string) => {
      addMessage({
        id: generateId(),
        role: 'user',
        content: `<p>${text}</p>`,
        timestamp: Date.now(),
        parentId: messages.length > 0 ? messages[messages.length - 1]!.id : null,
      })
      setPendingRequest({
        sessionId: activeSessionId ?? undefined,
        message: text,
        type: 'message',
        page,
        context,
      })
    },
    [addMessage, messages, activeSessionId, page, context]
  )

  const handleApprovalAction = useCallback((request: KopilotRequest) => {
    setPendingRequest(request)
  }, [])

  const handleEditMessage = useCallback(
    (messageId: string) => {
      setEditingMessage(messageId)
    },
    [setEditingMessage]
  )

  const handleRetryMessage = useCallback(
    (assistantMessageId: string) => {
      const assistantMsg = messageMap[assistantMessageId]
      if (!assistantMsg?.parentId) return

      const userMsg = messageMap[assistantMsg.parentId]
      if (!userMsg || userMsg.role !== 'user') return

      const text = userMsg.content.replace(/<[^>]*>/g, '')

      setPendingRequest({
        sessionId: activeSessionId ?? undefined,
        message: text,
        type: 'message',
        page,
        context,
      })
    },
    [messageMap, activeSessionId, page, context]
  )

  const handleRetryLastMessage = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return

    const text = lastUserMsg.content.replace(/<[^>]*>/g, '')

    setPendingRequest({
      sessionId: activeSessionId ?? undefined,
      message: text,
      type: 'message',
      page,
      context,
    })
  }, [messages, activeSessionId, page, context])

  return (
    <>
      <KopilotMessageList
        contentClassName={contentClassName}
        onApprovalAction={handleApprovalAction}
        onEditMessage={handleEditMessage}
        onRetryMessage={handleRetryMessage}
        onRetryLastMessage={handleRetryLastMessage}
        onFeedback={handleFeedback}
        onSuggestionClick={handleSuggestionClick}
      />
      <KopilotStatusBar contentClassName={contentClassName} />
      <KopilotComposer
        ref={composerRef}
        page={page}
        context={context}
        onSend={handleSend}
        contentClassName={contentClassName}
      />
    </>
  )
}
