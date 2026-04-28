// apps/web/src/components/kopilot/ui/kopilot-message-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowDown } from 'lucide-react'
import { motion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { type KopilotMessage, useKopilotStore } from '../stores/kopilot-store'
import { getApprovalCard } from './blocks/approval-card-registry'
import { AuxxBlock } from './blocks/auxx-block'
import { GenericApprovalCard } from './blocks/generic-approval-card'
import { KopilotEmptyState } from './kopilot-empty-state'
import { AssistantMessage } from './messages/assistant-message'
import { BranchNavigator } from './messages/branch-navigator'
import { ThinkingSteps } from './messages/thinking-steps'
import { UserMessage } from './messages/user-message'
import { SparkleIcon } from './sparkle-icon'

export interface KopilotMessageListHandle {
  pinNewestTurn: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

interface KopilotMessageListProps {
  ref?: React.Ref<KopilotMessageListHandle>
  onApprovalAction: (request: KopilotRequest) => void
  onEditMessage?: (messageId: string) => void
  onRetryMessage?: (messageId: string) => void
  onFeedback?: (messageId: string, isPositive: boolean) => void
  onSuggestionClick?: (text: string) => void
  /** Class applied to inner content for centering/width constraints */
  contentClassName?: string
}

interface TurnGroup {
  key: string
  messages: KopilotMessage[]
}

/**
 * Subtracted from the viewport height when inflating the last turn group's
 * min-height. Accounts for the inner container's vertical padding (p-4 → 32)
 * so the freshly-pinned user message lands at its natural padding-top inset
 * (~16px below the viewport top, clear of the top fade mask).
 */
const PIN_INFLATE_OFFSET = 32

/**
 * Group consecutive messages into turn groups: a turn starts at each user
 * message and absorbs every following non-user message until the next user.
 */
function groupTurns(messages: KopilotMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let current: TurnGroup | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      current = { key: m.id, messages: [m] }
      groups.push(current)
    } else {
      if (!current) {
        current = { key: m.id, messages: [] }
        groups.push(current)
      }
      current.messages.push(m)
    }
  }
  return groups
}

export function KopilotMessageList({
  ref,
  onApprovalAction,
  onEditMessage,
  onRetryMessage,
  onFeedback,
  onSuggestionClick,
  contentClassName,
}: KopilotMessageListProps) {
  const messages = useKopilotStore((s) => s.messages)
  const editingMessageId = useKopilotStore((s) => s.editingMessageId)
  const streamingContent = useKopilotStore((s) => s.stream.streamingContent)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const updateMessage = useKopilotStore((s) => s.updateMessage)
  const childrenMap = useKopilotStore((s) => s.childrenMap)
  const setActiveBranch = useKopilotStore((s) => s.setActiveBranch)
  const thinkingGroups = useKopilotStore((s) => s.thinkingGroups)
  const activeThinkingGroupId = useKopilotStore((s) => s.activeThinkingGroupId)
  const activeThinkingGroup = activeThinkingGroupId ? thinkingGroups[activeThinkingGroupId] : null

  const [viewportEl, setViewportElState] = useState<HTMLDivElement | null>(null)
  const isAtBottom = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [viewportPx, setViewportPx] = useState<number | null>(null)
  const [inflateLast, setInflateLast] = useState(() => messages.length <= 1)
  const [pinTick, setPinTick] = useState(0)
  const pinBehaviorRef = useRef<ScrollBehavior>('smooth')
  const lastUserIdRef = useRef<string | null>(null)
  const prevLenRef = useRef(0)
  const sessionMountedRef = useRef(false)

  // Callback ref so viewport setup re-runs whenever the scroll node mounts/unmounts
  // (the empty-state branch unmounts the ScrollArea, so this matters).
  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportElState(node)
    if (node) setViewportPx(node.clientHeight)
  }, [])

  const visibleMessages = useMemo(() => {
    if (!editingMessageId) return messages
    const editIndex = messages.findIndex((m) => m.id === editingMessageId)
    if (editIndex === -1) return messages
    return messages.slice(0, editIndex)
  }, [messages, editingMessageId])

  const groups = useMemo(() => groupTurns(visibleMessages), [visibleMessages])
  const showEmptyState = messages.length === 0 && !isStreaming

  // Track scroll position + observe viewport size; keyed on the actual node.
  useEffect(() => {
    if (!viewportEl) return
    setViewportPx(viewportEl.clientHeight)

    // ResizeObserver fires per layout tick; coalesce to one rAF so dragging
    // the window edge doesn't trigger a render storm.
    let rafId = 0
    let lastPx = viewportEl.clientHeight
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const next = viewportEl.clientHeight
        if (next !== lastPx) {
          lastPx = next
          setViewportPx(next)
        }
      })
    })
    ro.observe(viewportEl)

    const onScroll = () => {
      const distance = viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight
      isAtBottom.current = distance < 20
      setShowScrollDown(distance >= 20)
    }
    viewportEl.addEventListener('scroll', onScroll, { passive: true })

    // First-paint: snap to bottom of the existing transcript.
    viewportEl.scrollTo({ top: viewportEl.scrollHeight })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      viewportEl.removeEventListener('scroll', onScroll)
    }
  }, [viewportEl])

  // Follow the stream: stay pinned to bottom while content grows, if user was at bottom.
  // messages/streamingContent are trigger-only deps — we don't read them inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    if (!viewportEl) return
    if (isAtBottom.current) {
      viewportEl.scrollTop = viewportEl.scrollHeight
    }
    const distance = viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight
    setShowScrollDown(distance >= 20)
  }, [messages, streamingContent, viewportEl])

  // Deflate when switching sessions (not on initial mount). activeSessionId
  // is intentionally a trigger-only dep — we don't read it inside the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only dep
  useEffect(() => {
    if (!sessionMountedRef.current) {
      sessionMountedRef.current = true
      return
    }
    setInflateLast(false)
  }, [activeSessionId])

  // Pin scroll: runs after the inflated min-height commits to layout, so
  // scrollHeight reflects the fully-grown last group. Intentionally NOT
  // dependent on viewportPx — we only want to scroll on actual pin events,
  // not on every resize tick.
  useLayoutEffect(() => {
    if (pinTick === 0) return
    if (!viewportEl) return
    viewportEl.scrollTo({ top: viewportEl.scrollHeight, behavior: pinBehaviorRef.current })
  }, [pinTick, viewportEl])

  const pinNewestTurn = useCallback((behavior: ScrollBehavior = 'smooth') => {
    pinBehaviorRef.current = behavior
    setInflateLast(true)
    setPinTick((t) => t + 1)
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (!viewportEl) return
      viewportEl.scrollTo({ top: viewportEl.scrollHeight, behavior })
    },
    [viewportEl]
  )

  // Detect fresh user submissions (composer / suggestion / any other addMessage path)
  // and pin the new turn to the top of the viewport.
  useEffect(() => {
    let lastUserId: string | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') {
        lastUserId = messages[i]!.id
        break
      }
    }
    const grew = messages.length === prevLenRef.current + 1

    if (grew && lastUserId && lastUserId !== lastUserIdRef.current) {
      pinNewestTurn('smooth')
    }

    lastUserIdRef.current = lastUserId
    prevLenRef.current = messages.length
  }, [messages, pinNewestTurn])

  useImperativeHandle(ref, () => ({ pinNewestTurn, scrollToBottom }), [
    pinNewestTurn,
    scrollToBottom,
  ])

  const handleApproval = useCallback(
    (
      messageId: string,
      action: 'approved' | 'rejected',
      inputAmendment?: Record<string, unknown>
    ) => {
      const msg = messages.find((m) => m.id === messageId)
      if (msg?.approval) {
        updateMessage(messageId, {
          approval: { ...msg.approval, status: action },
        })
      }
      onApprovalAction({
        sessionId: activeSessionId ?? undefined,
        message: action,
        type: 'approval',
        approvalAction: action === 'approved' ? 'approve' : 'reject',
        inputAmendment,
      })
    },
    [activeSessionId, messages, updateMessage, onApprovalAction]
  )

  const renderMessage = (message: KopilotMessage): React.ReactNode => {
    const parentKey = message.parentId ?? 'root'
    const siblings = childrenMap[parentKey] ?? []
    const hasBranches = siblings.length > 1

    let messageEl: React.ReactNode = null

    if (message.approval) {
      const ApprovalCard = getApprovalCard(message.approval.toolName) ?? GenericApprovalCard
      messageEl = (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <ApprovalCard
            toolName={message.approval.toolName}
            toolCallId={message.approval.toolCallId}
            args={message.approval.args}
            status={message.approval.status}
            onApprove={(inputAmendment) => handleApproval(message.id, 'approved', inputAmendment)}
            onReject={() => handleApproval(message.id, 'rejected')}
          />
        </motion.div>
      )
    } else {
      switch (message.role) {
        case 'user':
          messageEl = (
            <UserMessage
              message={message}
              onEdit={onEditMessage ? () => onEditMessage(message.id) : undefined}
              onRetry={onRetryMessage ? () => onRetryMessage(message.id) : undefined}
            />
          )
          break
        case 'assistant':
          messageEl = (
            <AssistantMessage
              message={message}
              feedback={message.feedback}
              onThumbsUp={onFeedback ? () => onFeedback(message.id, true) : undefined}
              onThumbsDown={onFeedback ? () => onFeedback(message.id, false) : undefined}
            />
          )
          break
        case 'tool':
          return null
        case 'block':
          if (!message.block) return null
          messageEl = <AuxxBlock type={message.block.type} data={message.block.data} />
          break
        default:
          break
      }
    }

    if (!messageEl) return null

    return (
      <div key={message.id}>
        {messageEl}
        {hasBranches && !isStreaming && (
          <BranchNavigator
            currentChildId={message.id}
            siblings={siblings}
            onNavigate={(childId) => setActiveBranch(parentKey, childId)}
          />
        )}
      </div>
    )
  }

  if (showEmptyState) {
    return <KopilotEmptyState onSuggestionClick={onSuggestionClick} />
  }

  const showOrphanStreaming = groups.length === 0 && isStreaming

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <ScrollArea viewportRef={setViewportRef} className='min-h-0 flex-1'>
        <div className={cn('flex flex-col gap-3 p-4 pr-5!', contentClassName)}>
          {groups.map((group, i) => {
            const isLast = i === groups.length - 1
            const minH =
              isLast && inflateLast && viewportPx !== null
                ? `${viewportPx - PIN_INFLATE_OFFSET}px`
                : undefined
            return (
              <div
                key={group.key}
                className='flex flex-col gap-3'
                style={minH ? { minHeight: minH } : undefined}>
                {group.messages.map((m) => renderMessage(m))}
                {isLast &&
                  isStreaming &&
                  !streamingContent &&
                  activeThinkingGroup &&
                  activeThinkingGroup.steps.length > 0 && (
                    <div className='flex gap-2'>
                      <SparkleIcon />
                      <div className='min-w-0 flex-1'>
                        <ThinkingSteps group={activeThinkingGroup} />
                      </div>
                    </div>
                  )}
                {isLast && isStreaming && streamingContent && (
                  <AssistantMessage streamingContent={streamingContent} />
                )}
              </div>
            )
          })}
          {showOrphanStreaming && (
            <div
              className='flex flex-col gap-3'
              style={
                inflateLast && viewportPx !== null
                  ? { minHeight: `${viewportPx - PIN_INFLATE_OFFSET}px` }
                  : undefined
              }>
              {!streamingContent && activeThinkingGroup && activeThinkingGroup.steps.length > 0 && (
                <div className='flex gap-2'>
                  <SparkleIcon />
                  <div className='min-w-0 flex-1'>
                    <ThinkingSteps group={activeThinkingGroup} />
                  </div>
                </div>
              )}
              {streamingContent && <AssistantMessage streamingContent={streamingContent} />}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Scroll to bottom — overlays the ScrollArea, doesn't contribute to scrollHeight */}
      {showScrollDown && (
        <div className='pointer-events-none absolute inset-x-0 bottom-2 flex justify-center'>
          <Button
            size='sm'
            variant='outline'
            className='pointer-events-auto h-7 gap-1 rounded-full shadow-md'
            onClick={() => scrollToBottom('smooth')}>
            <ArrowDown className='size-3' />
            New messages
          </Button>
        </div>
      )}
    </div>
  )
}
