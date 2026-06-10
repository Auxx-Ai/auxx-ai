// apps/web/src/components/kopilot/ui/kopilot-chat.tsx

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef } from 'react'
import { useLoadSession } from '../hooks/use-kopilot-sessions'
import { type KopilotRequest, useKopilotStore } from '../stores/kopilot-store'
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
   * Agent Chat-tab test-run flag — sends `useDraft: true` so the run resolves the
   * agent's unpublished draft config (server admin-gated). Only the agent detail
   * Chat tab sets this; composer DMs to an agent leave it off (they run the live
   * version). See plans/agents/agent-versions/build-plan.md §4.2.
   */
  useDraft?: boolean
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
  useDraft,
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
  // Submissions go through the store; the app-level KopilotRuntime owns the
  // SSE connection so turns keep streaming when this surface unmounts.
  const setPendingRequest = useKopilotStore((s) => s.setPendingRequest)

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
      ...(useDraft ? { useDraft: true } : {}),
    }),
    [agentId, sessionType, triggerKind, useDraft]
  )

  const handleSend = useCallback(
    (request: KopilotRequest) => {
      setPendingRequest(augmentRequest(request))
    },
    [augmentRequest, setPendingRequest]
  )

  const handleSuggestionClick = useCallback(
    (text: string, autoSubmit: boolean) => {
      if (!autoSubmit) {
        composerRef.current?.populate(text)
        return
      }
      // Read fresh state — `messages` / `activeSessionId` in closure can be
      // pre-`startNewSession` when the auto-submit effect fires right after
      // the load-initial effect clears state. Using the closure value would
      // orphan the new message under a stale parentId (invisible in the
      // tree) and send the SSE to the previous session id.
      const store = useKopilotStore.getState()
      const freshMessages = store.messages
      addMessage({
        id: generateId(),
        role: 'user',
        content: `<p>${text}</p>`,
        timestamp: Date.now(),
        parentId: freshMessages.length > 0 ? freshMessages[freshMessages.length - 1]!.id : null,
      })
      const merged = applyChipDismissals(
        selectMergedContext(store.contextSlices),
        store.dismissedChipKeys
      )
      store.clearDismissedChips()
      setPendingRequest(
        augmentRequest({
          sessionId: store.activeSessionId ?? undefined,
          message: text,
          type: 'message',
          page: merged.page ?? page,
          context: merged,
        })
      )
    },
    [addMessage, page, augmentRequest, setPendingRequest]
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

  // Consume a store-queued seed addressed to this surface (Fix-with-Kopilot).
  // Unlike `initialMessage` this submits into an EXISTING session, so it waits
  // until the panel's target session is the active one (load settled).
  const pendingSeed = useKopilotStore((s) => s.pendingSeed)
  const setPendingSeed = useKopilotStore((s) => s.setPendingSeed)
  useEffect(() => {
    if (!pendingSeed || pendingSeed.page !== page) return
    if (initialSessionId && activeSessionId !== initialSessionId) return
    setPendingSeed(null)
    handleSuggestionClick(pendingSeed.text, true)
  }, [pendingSeed, page, initialSessionId, activeSessionId, setPendingSeed, handleSuggestionClick])

  const handleApprovalAction = useCallback(
    (request: KopilotRequest) => {
      // Approvals resume a paused turn whose pending tool was registered for a
      // specific page. Attach the live surface (same as a normal send) so the
      // server rebuilds the page-scoped toolset and resume can find the tool.
      // The client's context is fresher than the persisted fallback; the
      // server-side restore covers the headless task-notification drain.
      const store = useKopilotStore.getState()
      const merged = applyChipDismissals(
        selectMergedContext(store.contextSlices),
        store.dismissedChipKeys
      )
      setPendingRequest(
        augmentRequest({ ...request, page: request.page ?? merged.page ?? page, context: merged })
      )
    },
    [augmentRequest, setPendingRequest, page]
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
    [messageMap, activeSessionId, page, augmentRequest, setPendingRequest]
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
