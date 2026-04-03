// apps/web/src/components/kopilot/ui/kopilot-panel.tsx

'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { api } from '~/trpc/react'
import { useKopilotSessions, useLoadSession } from '../hooks/use-kopilot-sessions'
import { type KopilotRequest, useKopilotSSE } from '../hooks/use-kopilot-sse'
import { useKopilotStore } from '../stores/kopilot-store'
import './blocks/register-blocks'
import { KopilotComposer, type KopilotComposerHandle } from './kopilot-composer'
import { KopilotMessageList } from './kopilot-message-list'
import { KopilotStatusBar } from './kopilot-status-bar'

export interface KopilotPanelProps {
  /** Current page context (e.g. 'mail') */
  page: string
  /** Page-specific context */
  context?: Record<string, unknown>
}

export function KopilotPanel({ page, context }: KopilotPanelProps) {
  const setPanelOpen = useKopilotStore((s) => s.setPanelOpen)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const startNewSession = useKopilotStore((s) => s.startNewSession)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)
  const messages = useKopilotStore((s) => s.messages)
  const setMessageFeedback = useKopilotStore((s) => s.setMessageFeedback)

  const composerRef = useRef<KopilotComposerHandle>(null)
  const [pendingRequest, setPendingRequest] = useState<KopilotRequest | null>(null)
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)

  // SSE hook
  useKopilotSSE({
    pendingRequest,
    onRequestSent: () => setPendingRequest(null),
  })

  // Session hooks
  const {
    sessionOptions,
    isLoading: isLoadingSessions,
    deleteSession,
    updateTitle,
  } = useKopilotSessions()
  const loadSession = useLoadSession()

  const prevSessionOptionsRef = useRef<SelectOption[]>(sessionOptions)
  useEffect(() => {
    prevSessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  // Load persisted session on mount (when panel opens with a stored activeSessionId)
  const hasLoadedInitialRef = useRef(false)
  useEffect(() => {
    if (hasLoadedInitialRef.current) return
    if (activeSessionId && messages.length === 0) {
      hasLoadedInitialRef.current = true
      loadSession(activeSessionId)
    }
  }, [activeSessionId, messages.length, loadSession])

  // Feedback
  const rateMessage = api.kopilot.rateMessage.useMutation()

  const handleFeedback = useCallback(
    (messageId: string, isPositive: boolean) => {
      if (!activeSessionId) return

      const current = messageMap[messageId]?.feedback?.isPositive
      const newValue = current === isPositive ? null : isPositive

      // Optimistic update
      setMessageFeedback(messageId, newValue)

      // Fire-and-forget persist
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

      // The parent of the assistant message is the user message
      const userMsg = messageMap[assistantMsg.parentId]
      if (!userMsg || userMsg.role !== 'user') return

      // Strip HTML to get plain text for re-sending
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

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      loadSession(sessionId)
      setSessionPickerOpen(false)
    },
    [loadSession]
  )

  const handleNewSession = useCallback(() => {
    console.log('[KopilotPanel] handleNewSession, composerRef:', !!composerRef.current)
    startNewSession()
    setSessionPickerOpen(false)
    requestAnimationFrame(() => {
      console.log('[KopilotPanel] rAF fired, composerRef:', !!composerRef.current)
      composerRef.current?.focus()
    })
  }, [startNewSession])

  const handleOptionsChange = useCallback(
    (updatedOptions: SelectOption[]) => {
      const previous = prevSessionOptionsRef.current

      // Detect renames: same value, different label
      for (const opt of updatedOptions) {
        const prev = previous.find((p) => p.value === opt.value)
        if (prev && prev.label !== opt.label) {
          updateTitle.mutate({ sessionId: opt.value, title: opt.label })
        }
      }

      // Detect deletes: in previous but not in updated
      for (const prev of previous) {
        if (!updatedOptions.find((o) => o.value === prev.value)) {
          deleteSession.mutate({ sessionId: prev.value })
          if (prev.value === activeSessionId) {
            startNewSession()
          }
        }
      }
    },
    [activeSessionId, deleteSession, updateTitle, startNewSession]
  )

  // Active session title for picker button
  const activeSessionTitle = useMemo(() => {
    if (!activeSessionId) return 'New session'
    const match = sessionOptions.find((o) => o.value === activeSessionId)
    return match?.label || 'New session'
  }, [activeSessionId, sessionOptions])

  return (
    <div className='flex h-full flex-col'>
      <DrawerHeader
        title={
          <Popover open={sessionPickerOpen} onOpenChange={setSessionPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant='ghost' size='sm' className='h-7 max-w-full gap-1'>
                <span className='truncate'>{activeSessionTitle}</span>
                <ChevronDown className='size-3 shrink-0' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-64 p-0' align='start'>
              <MultiSelectPicker
                options={sessionOptions}
                value={activeSessionId ? [activeSessionId] : []}
                onChange={() => {}}
                multi={false}
                onSelectSingle={handleSessionSelect}
                canManage={true}
                canAdd={false}
                manageLabel='Manage chats'
                placeholder='Search chats...'
                isLoading={isLoadingSessions}
                onOptionsChange={handleOptionsChange}
              />
            </PopoverContent>
          </Popover>
        }
        actions={
          <Button variant='ghost' size='icon' className='size-7' onClick={handleNewSession}>
            <Plus className='size-3.5' />
          </Button>
        }
        onClose={() => setPanelOpen(false)}
      />

      <KopilotMessageList
        onApprovalAction={handleApprovalAction}
        onEditMessage={handleEditMessage}
        onRetryMessage={handleRetryMessage}
        onFeedback={handleFeedback}
      />
      <KopilotStatusBar />
      <KopilotComposer ref={composerRef} page={page} context={context} onSend={handleSend} />
    </div>
  )
}
