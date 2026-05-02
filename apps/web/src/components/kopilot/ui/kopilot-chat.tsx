// apps/web/src/components/kopilot/ui/kopilot-chat.tsx

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLoadSession } from '../hooks/use-kopilot-sessions'
import { type KopilotRequest, useKopilotSSE } from '../hooks/use-kopilot-sse'
import { useKopilotStore } from '../stores/kopilot-store'
import { applyChipDismissals, selectMergedContext } from '../stores/select-context'
import './blocks/register-blocks'
import { api } from '~/trpc/react'
import { KopilotComposer, type KopilotComposerHandle } from './kopilot-composer'
import { KopilotMessageList, type KopilotMessageListHandle } from './kopilot-message-list'
import { KopilotStatusBar } from './kopilot-status-bar'

export interface KopilotChatProps {
  /**
   * Page identifier — used as a fallback when no `<KopilotContext>` has
   * registered a `page` field. The standalone /app/kopilot route hardcodes
   * 'kopilot' here; the panel reads it from merged store and passes it through.
   */
  page: string
  /** Called when user switches sessions. Panel: updates store. Page: router.push. */
  onSessionChange?: (sessionId: string | null) => void
  /** Initial session to load on mount */
  initialSessionId?: string | null
  /** Class applied to inner content areas (message list, composer) for centering/width constraints */
  contentClassName?: string
}

export function KopilotChat({
  page,
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
  const messageListRef = useRef<KopilotMessageListHandle>(null)
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

    // If an explicit initialSessionId is provided, load it — unless the store
    // already has it loaded. Skip only when the id matches AND we have
    // messages: this is the post-SSE case where /new flipped to /[sessionId]
    // via history.replaceState and reloading would clobber the in-flight
    // stream. After a cold refresh the id is rehydrated from localStorage
    // but messages aren't persisted, so we must still load.
    if (initialSessionId) {
      hasLoadedInitialRef.current = true
      const alreadyLoaded = initialSessionId === activeSessionId && messages.length > 0
      if (!alreadyLoaded) {
        loadSession(initialSessionId)
      }
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
      if (!activeSessionId || rateMessage.isPending) return

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
      const store = useKopilotStore.getState()
      const merged = applyChipDismissals(
        selectMergedContext(store.contextSlices),
        store.dismissedChipKeys
      )
      store.clearDismissedChips()
      setPendingRequest({
        sessionId: activeSessionId ?? undefined,
        message: text,
        type: 'message',
        page: merged.page ?? page,
        context: merged,
      })
    },
    [addMessage, messages, activeSessionId, page]
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
    (userMessageId: string) => {
      const userMsg = messageMap[userMessageId]
      if (!userMsg || userMsg.role !== 'user') return

      const text = userMsg.content.replace(/<[^>]*>/g, '')
      const store = useKopilotStore.getState()
      const merged = applyChipDismissals(
        selectMergedContext(store.contextSlices),
        store.dismissedChipKeys
      )
      store.clearDismissedChips()

      setPendingRequest({
        sessionId: activeSessionId ?? undefined,
        message: text,
        type: 'message',
        page: merged.page ?? page,
        context: merged,
      })
    },
    [messageMap, activeSessionId, page]
  )

  return (
    <>
      <KopilotMessageList
        ref={messageListRef}
        contentClassName={contentClassName}
        onApprovalAction={handleApprovalAction}
        onEditMessage={handleEditMessage}
        onRetryMessage={handleRetryMessage}
        onFeedback={handleFeedback}
        onSuggestionClick={handleSuggestionClick}
      />
      <KopilotStatusBar contentClassName={contentClassName} />
      <KopilotComposer
        ref={composerRef}
        page={page}
        onSend={handleSend}
        contentClassName={contentClassName}
      />
    </>
  )
}
