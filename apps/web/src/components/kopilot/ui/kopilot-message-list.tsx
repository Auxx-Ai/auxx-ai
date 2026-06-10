// apps/web/src/components/kopilot/ui/kopilot-message-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowDown } from 'lucide-react'
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
import { useKopilotChatOptions } from '../options'
import { type KopilotMessage, useKopilotStore } from '../stores/kopilot-store'
import { isTaskNotificationMessage } from '../utils/task-notifications'
import { KopilotEmptyState } from './kopilot-empty-state'
import { AssistantMessage, type InlineApprovalLookup } from './messages/assistant-message'
import { AssistantThinkingStatus } from './messages/assistant-thinking-status'
import { BranchNavigator } from './messages/branch-navigator'
import { TaskNotificationChip } from './messages/task-notification-chip'
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
  onSuggestionClick?: (text: string, autoSubmit: boolean) => void
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
  const { renderEmptyState } = useKopilotChatOptions()
  const messages = useKopilotStore((s) => s.messages)
  const editingMessageId = useKopilotStore((s) => s.editingMessageId)
  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const updateMessage = useKopilotStore((s) => s.updateMessage)
  const childrenMap = useKopilotStore((s) => s.childrenMap)
  const setActiveBranch = useKopilotStore((s) => s.setActiveBranch)

  const [viewportEl, setViewportElState] = useState<HTMLDivElement | null>(null)
  const isAtBottom = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [viewportPx, setViewportPx] = useState<number | null>(null)
  const [inflateLast, setInflateLast] = useState(() => messages.length <= 1)
  const [pinTick, setPinTick] = useState(0)
  const pinBehaviorRef = useRef<ScrollBehavior>('smooth')
  // True while a smooth pin scroll is in flight — used to suppress the
  // streaming follow-effect's instant `scrollTop =` assignment, which would
  // otherwise interrupt the smooth animation when stream chunks arrive.
  const pinningRef = useRef(false)
  const pinReleaseTimeoutRef = useRef<number | null>(null)
  // Sentinel placed after the last meaningful child of the last turn group.
  // Used to compute "at bottom" relative to the actual content end, not the
  // bottom of the inflated empty space.
  const contentEndRef = useRef<HTMLDivElement | null>(null)
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

  // Phase A: streaming has started but the server hasn't opened the assistant
  // bubble yet (no `assistant-message-started` event). Render a placeholder
  // sparkle-bubble so the inline thinking status shows immediately.
  const trailing = visibleMessages[visibleMessages.length - 1]
  const showPlaceholder = isStreaming && (!trailing || trailing.role !== 'assistant')

  // Build a toolCallId → approval system message lookup so assistant bubbles
  // can render the approval card inline at the tool_call position. The system
  // message itself still lives in `messages` for persistence/refresh, but it
  // is skipped from the standalone render path below.
  const approvalByToolCallId = useMemo<InlineApprovalLookup>(() => {
    const map = new Map<string, KopilotMessage>()
    for (const m of visibleMessages) {
      if (m.role === 'system' && m.approval) {
        map.set(m.approval.toolCallId, m)
      }
    }
    return (toolCallId: string) => map.get(toolCallId)
  }, [visibleMessages])

  /**
   * Distance from the viewport bottom to the sentinel placed at the end of
   * meaningful content. Positive = sentinel is below the viewport (more
   * content to scroll down to). Negative or near-zero = caught up.
   * Returns null when sentinel/viewport refs aren't ready yet.
   */
  const measureContentEndDistance = useCallback((): number | null => {
    const sentinel = contentEndRef.current
    if (!sentinel || !viewportEl) return null
    const sentinelRect = sentinel.getBoundingClientRect()
    const viewportRect = viewportEl.getBoundingClientRect()
    return sentinelRect.bottom - viewportRect.bottom
  }, [viewportEl])

  const updateBottomState = useCallback(() => {
    const distance = measureContentEndDistance()
    if (distance === null) {
      isAtBottom.current = true
      setShowScrollDown(false)
      return
    }
    isAtBottom.current = distance <= 20
    setShowScrollDown(distance > 20)
  }, [measureContentEndDistance])

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
      updateBottomState()
    }
    viewportEl.addEventListener('scroll', onScroll, { passive: true })

    // First-paint: snap to bottom of the existing transcript.
    viewportEl.scrollTo({ top: viewportEl.scrollHeight })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      viewportEl.removeEventListener('scroll', onScroll)
    }
  }, [viewportEl, updateBottomState])

  // Follow the stream: stay pinned to bottom while content grows, if user was at bottom.
  // `messages` is a trigger-only dep — text/tool deltas mutate visible messages in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    if (!viewportEl) return
    // Skip while a smooth pin scroll is animating — assigning scrollTop here
    // would interrupt the animation mid-flight on every stream chunk.
    if (pinningRef.current) return
    if (isAtBottom.current) {
      viewportEl.scrollTop = viewportEl.scrollHeight
    }
    updateBottomState()
  }, [messages, viewportEl, updateBottomState])

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
    pinningRef.current = true
    if (pinReleaseTimeoutRef.current !== null) {
      window.clearTimeout(pinReleaseTimeoutRef.current)
    }
    // Smooth scrolls typically settle well under 800ms; release the guard
    // afterwards so subsequent stream chunks can resume bottom-following.
    pinReleaseTimeoutRef.current = window.setTimeout(() => {
      pinningRef.current = false
      pinReleaseTimeoutRef.current = null
    }, 800)
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

  useEffect(() => {
    return () => {
      if (pinReleaseTimeoutRef.current !== null) {
        window.clearTimeout(pinReleaseTimeoutRef.current)
      }
    }
  }, [])

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

    // System approval messages persist for refresh but render inline within
    // the assistant bubble that owns the tool_call — skip them here.
    if (message.role === 'system' && message.approval) return null

    let messageEl: React.ReactNode = null

    switch (message.role) {
      case 'user':
        // Task notifications are machine-injected continuations stamped with
        // an origin marker — render a muted system chip, never a user bubble,
        // and exclude them from edit/retry affordances.
        if (isTaskNotificationMessage(message)) {
          messageEl = <TaskNotificationChip message={message} />
          break
        }
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
            isStreaming={isStreaming && message.id === messages[messages.length - 1]?.id}
            feedback={message.feedback}
            onThumbsUp={onFeedback ? () => onFeedback(message.id, true) : undefined}
            onThumbsDown={onFeedback ? () => onFeedback(message.id, false) : undefined}
            approvalForToolCall={approvalByToolCallId}
            onApproval={handleApproval}
          />
        )
        break
      default:
        break
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
    if (renderEmptyState) {
      return <>{renderEmptyState({ onSuggestionClick })}</>
    }
    return <KopilotEmptyState onSuggestionClick={onSuggestionClick} />
  }

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
                {isLast && showPlaceholder && (
                  <div className='group/message flex gap-2'>
                    <SparkleIcon />
                    <div className='min-w-0 flex-1 space-y-1'>
                      <AssistantThinkingStatus />
                    </div>
                  </div>
                )}
                {isLast && <div ref={contentEndRef} aria-hidden className='h-0 w-0' />}
              </div>
            )
          })}
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
