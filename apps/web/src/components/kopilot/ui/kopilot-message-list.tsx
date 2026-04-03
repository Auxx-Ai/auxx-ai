// apps/web/src/components/kopilot/ui/kopilot-message-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ArrowDown, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { useKopilotStore } from '../stores/kopilot-store'
import { getApprovalCard } from './blocks/approval-card-registry'
import { GenericApprovalCard } from './blocks/generic-approval-card'
import { AssistantMessage } from './messages/assistant-message'
import { BranchNavigator } from './messages/branch-navigator'
import { ThinkingSteps } from './messages/thinking-steps'
import { UserMessage } from './messages/user-message'

interface KopilotMessageListProps {
  onApprovalAction: (request: KopilotRequest) => void
  onEditMessage?: (messageId: string) => void
  onRetryMessage?: (messageId: string) => void
  onFeedback?: (messageId: string, isPositive: boolean) => void
}

export function KopilotMessageList({
  onApprovalAction,
  onEditMessage,
  onRetryMessage,
  onFeedback,
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

  const bottomRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  // Observe bottom sentinel for auto-scroll using the scroll viewport as root
  useEffect(() => {
    const sentinel = bottomRef.current
    const viewport = viewportRef.current
    if (!sentinel || !viewport) {
      console.log(
        '[KopilotMessageList] IntersectionObserver skipped — sentinel:',
        !!sentinel,
        'viewport:',
        !!viewport
      )
      return
    }

    console.log('[KopilotMessageList] IntersectionObserver attached, root:', viewport)

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          console.log(
            '[KopilotMessageList] isAtBottom:',
            entry.isIntersecting,
            'ratio:',
            entry.intersectionRatio
          )
          setIsAtBottom(entry.isIntersecting)
        }
      },
      { root: viewport, threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // Auto-scroll when new messages arrive or streaming updates
  useEffect(() => {
    if (isAtBottom && viewportRef.current) {
      console.log('[KopilotMessageList] Auto-scrolling to bottom')
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages, streamingContent, isAtBottom])

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
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
        <div className='flex size-10 items-center justify-center rounded-full bg-purple-500/10'>
          <Sparkles className='size-5 text-purple-500' />
        </div>
        <div className='space-y-1'>
          <p className='text-sm font-medium'>Kopilot</p>
          <p className='text-xs text-muted-foreground'>
            Ask about tickets, contacts, or anything in your inbox.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea viewportRef={viewportRef} className='flex-1'>
      <div className='space-y-3 p-4'>
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
            )
          } else {
            switch (message.role) {
              case 'user':
                messageEl = (
                  <UserMessage
                    key={message.id}
                    message={message}
                    onEdit={onEditMessage ? () => onEditMessage(message.id) : undefined}
                  />
                )
                break
              case 'assistant':
                messageEl = (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    feedback={message.feedback}
                    onRetry={onRetryMessage ? () => onRetryMessage(message.id) : undefined}
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
              <div className='animate-hue-rotate relative size-fit'>
                <div className='bg-conic/decreasing relative flex size-5 items-center justify-center rounded-full from-violet-500 via-lime-300 to-violet-400 blur-md' />
                <div className='absolute inset-0 flex items-center justify-center'>
                  <Sparkles className='size-3.5' />
                </div>
              </div>
              <div className='min-w-0 flex-1'>
                <ThinkingSteps group={activeThinkingGroup} />
              </div>
            </div>
          )}

        {/* Streaming assistant message (responder output) */}
        {isStreaming && streamingContent && (
          <AssistantMessage streamingContent={streamingContent} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <div className='sticky bottom-2 flex justify-center'>
          <Button
            size='sm'
            variant='outline'
            className='h-7 gap-1 rounded-full shadow-md'
            onClick={scrollToBottom}>
            <ArrowDown className='size-3' />
            New messages
          </Button>
        </div>
      )}
    </ScrollArea>
  )
}
