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
  /**
   * Target a specific user-authored agent. When set, outgoing requests carry
   * `agentId` so newly-created sessions are bound to that agent and the engine
   * resolves its toolset / prompt config. Ignored on existing sessions.
   */
  agentId?: string | null
  /**
   * Session-domain discriminator for newly-created sessions ('kopilot' default,
   * 'builder' when this chat configures an agent). Ignored on existing sessions.
   */
  sessionType?: 'kopilot' | 'builder'
  /**
   * Trigger discriminator for the run. 'dm' means the chat surface is the
   * agent Chat tab (or, indirectly, the composer sender picker). The SSE
   * route uses this to gate the agent's `dm` AgentTrigger and layer in DM
   * trigger-instructions.
   */
  triggerKind?: 'dm'
  /**
   * If set AND `initialSessionId` is null, this text is auto-submitted as the
   * first user turn after mount — same path as clicking an `autoSubmit`
   * suggestion chip, no chip rendered. Used by the agent builder to fire a
   * template's seed prompt directly. Guarded by a ref so it only fires once.
   */
  initialMessage?: string | null
}

export function KopilotChat({
  page,
  onSessionChange,
  initialSessionId,
  contentClassName,
  agentId,
  sessionType,
  triggerKind,
  initialMessage,
}: KopilotChatProps) {
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)
  const messages = useKopilotStore((s) => s.messages)
  const setMessageFeedback = useKopilotStore((s) => s.setMessageFeedback)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const startNewSession = useKopilotStore((s) => s.startNewSession)

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

    // When `initialSessionId` is passed explicitly (even as null), it overrides
    // any persisted activeSessionId in the store. This prevents the agent
    // builder surface from rehydrating the last master-Kopilot session.
    if (initialSessionId !== undefined) {
      hasLoadedInitialRef.current = true
      if (initialSessionId === null) {
        // Explicit "start fresh" — clear any state left over from another
        // surface so old messages don't render before the user types.
        if (activeSessionId !== null || messages.length > 0) {
          startNewSession()
        }
        return
      }
      // Skip reload when the store already holds this session AND has
      // messages: post-SSE `/new` → `/[sessionId]` via history.replaceState
      // would otherwise clobber the in-flight stream. After a cold refresh
      // the id is rehydrated from localStorage but messages aren't persisted,
      // so we must still load.
      const alreadyLoaded = initialSessionId === activeSessionId && messages.length > 0
      if (!alreadyLoaded) {
        loadSession(initialSessionId)
      }
      return
    }

    // No prop provided → load persisted session if messages are empty.
    if (activeSessionId && messages.length === 0) {
      hasLoadedInitialRef.current = true
      loadSession(activeSessionId)
    }
  }, [initialSessionId, activeSessionId, messages.length, loadSession, startNewSession])

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

  const augmentRequest = useCallback(
    (request: KopilotRequest): KopilotRequest => ({
      ...request,
      ...(agentId ? { agentId } : {}),
      ...(sessionType ? { sessionType } : {}),
      ...(triggerKind ? { triggerKind } : {}),
    }),
    [agentId, sessionType, triggerKind]
  )

  const handleSend = useCallback(
    (request: KopilotRequest) => {
      setPendingRequest(augmentRequest(request))
    },
    [augmentRequest]
  )

  const handleSuggestionClick = useCallback(
    (text: string, autoSubmit: boolean) => {
      if (!autoSubmit) {
        composerRef.current?.populate(text)
        return
      }
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
      setPendingRequest(
        augmentRequest({
          sessionId: activeSessionId ?? undefined,
          message: text,
          type: 'message',
          page: merged.page ?? page,
          context: merged,
        })
      )
    },
    [addMessage, messages, activeSessionId, page, augmentRequest]
  )

  // Auto-submit `initialMessage` once on mount when no existing session.
  // Fires the same path as an autoSubmit suggestion chip, without rendering
  // one. The ref guard makes it idempotent across re-renders and prevents
  // a refresh from re-submitting.
  const hasAutoSubmittedRef = useRef(false)
  useEffect(() => {
    if (hasAutoSubmittedRef.current) return
    if (!initialMessage) return
    if (initialSessionId) return
    hasAutoSubmittedRef.current = true
    handleSuggestionClick(initialMessage, true)
  }, [initialMessage, initialSessionId, handleSuggestionClick])

  const handleApprovalAction = useCallback(
    (request: KopilotRequest) => {
      setPendingRequest(augmentRequest(request))
    },
    [augmentRequest]
  )

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

      setPendingRequest(
        augmentRequest({
          sessionId: activeSessionId ?? undefined,
          message: text,
          type: 'message',
          page: merged.page ?? page,
          context: merged,
        })
      )
    },
    [messageMap, activeSessionId, page, augmentRequest]
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
      <KopilotComposer
        ref={composerRef}
        page={page}
        onSend={handleSend}
        contentClassName={contentClassName}
      />
    </>
  )
}
