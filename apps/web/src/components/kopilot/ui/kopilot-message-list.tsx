// apps/web/src/components/kopilot/ui/kopilot-message-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowDown } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { useKopilotStore } from '../stores/kopilot-store'
import { getApprovalCard } from './blocks/approval-card-registry'
import { GenericApprovalCard } from './blocks/generic-approval-card'
import { KopilotEmptyState } from './kopilot-empty-state'
import { AssistantMessage } from './messages/assistant-message'
import { BranchNavigator } from './messages/branch-navigator'
import { ThinkingSteps } from './messages/thinking-steps'
import { UserMessage } from './messages/user-message'
import { SparkleIcon } from './sparkle-icon'

interface KopilotMessageListProps {
  onApprovalAction: (request: KopilotRequest) => void
  onEditMessage?: (messageId: string) => void
  onRetryMessage?: (messageId: string) => void
  onFeedback?: (messageId: string, isPositive: boolean) => void
  onSuggestionClick?: (text: string) => void
  /** Class applied to inner content for centering/width constraints */
  contentClassName?: string
}

export function KopilotMessageList({
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

  const viewportRef = useRef<HTMLDivElement>(null)
  const isAtBottom = useRef(true)

  // Track scroll position to know if user is at the bottom
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = () => {
      isAtBottom.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 20
    }
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll when new messages arrive or streaming updates
  useEffect(() => {
    if (isAtBottom.current && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })
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

  if (messages.length === 0 && !isStreaming) {
    return <KopilotEmptyState onSuggestionClick={onSuggestionClick} />
  }

  return (
    <ScrollArea viewportRef={viewportRef} className='flex-1'>
      <div className={cn('space-y-3 p-4 pr-5!', contentClassName)}>
        {messages.map((message, index) => {
          // During editing, hide the edited message and everything after it
          if (editingMessageId) {
            const editIndex = messages.findIndex((m) => m.id === editingMessageId)
            if (editIndex !== -1 && index >= editIndex) return null
          }

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
                  key={message.id}
                  toolName={message.approval.toolName}
                  toolCallId={message.approval.toolCallId}
                  args={message.approval.args}
                  status={message.approval.status}
                  onApprove={(inputAmendment) =>
                    handleApproval(message.id, 'approved', inputAmendment)
                  }
                  onReject={() => handleApproval(message.id, 'rejected')}
                />
              </motion.div>
            )
          } else {
            switch (message.role) {
              case 'user':
                messageEl = (
                  <UserMessage
                    key={message.id}
                    message={message}
                    onEdit={onEditMessage ? () => onEditMessage(message.id) : undefined}
                    onRetry={onRetryMessage ? () => onRetryMessage(message.id) : undefined}
                  />
                )
                break
              case 'assistant':
                messageEl = (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    feedback={message.feedback}
                    onThumbsUp={onFeedback ? () => onFeedback(message.id, true) : undefined}
                    onThumbsDown={onFeedback ? () => onFeedback(message.id, false) : undefined}
                  />
                )
                break
              case 'tool':
                // Tool messages are now shown in ThinkingSteps, not as individual messages
                return null
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
        })}

        {/* Show thinking steps while executor is running (before responder streams) */}
        {isStreaming &&
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

        {/* Streaming assistant message (responder output) */}
        {isStreaming && streamingContent && (
          <AssistantMessage streamingContent={streamingContent} />
        )}
      </div>

      {/* Scroll to bottom — visible only when BaseScrollArea sets data-overflow-y-end */}
      <div className='pointer-events-none sticky bottom-2 flex justify-center opacity-0 transition-opacity duration-300 [[data-overflow-y-end]_&]:pointer-events-auto [[data-overflow-y-end]_&]:opacity-100'>
        <Button
          size='sm'
          variant='outline'
          className='h-7 gap-1 rounded-full shadow-md'
          onClick={scrollToBottom}>
          <ArrowDown className='size-3' />
          New messages
        </Button>
      </div>
    </ScrollArea>
  )
}
