// src/components/mail/thread-details.tsx
'use client'

import { toRecordId } from '@auxx/lib/field-values/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useMemo, useRef } from 'react'
import { useMessageParticipants, useMessages, useThread } from '~/components/threads/hooks'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { useCompose } from '~/hooks/use-compose'
import { api } from '~/trpc/react'
import { CommentList } from '../global/comments/comment-list'
import type { MessageType } from './email-editor/types'
import { useComposeStore } from './store/compose-store'
import { ThreadFooter } from './thread-footer'
import { ThreadHeader } from './thread-header'
import { ThreadMessages } from './thread-messages'
import { useThreadContext } from './thread-provider'

/**
 * Main component for displaying thread details.
 * Includes messages, reply functionality, and comments.
 */
export default function ThreadDetails({ centered }: { centered?: boolean }) {
  const { threadId, replyBox, handlers, emailActions } = useThreadContext()
  const { thread, isLoading, isNotFound } = useThread({ threadId })
  const { openInline, close: closeCompose } = useCompose()
  const instanceIdRef = useRef<string | null>(null)
  const justCreatedRef = useRef(false)

  const { messages } = useMessages({ threadId, enabled: !!thread })
  const utils = api.useUtils()

  // Fetch scheduled messages for this thread
  const { data: scheduledMessagesData } = api.thread.getScheduledMessages.useQuery(
    { threadId },
    {
      enabled: !!thread,
      // Poll every 30s if there are pending scheduled messages
      refetchInterval: (query) => {
        const data = query.state.data
        return data?.some((m) => m.status === 'PENDING') ? 30_000 : false
      },
    }
  )

  // Sync scheduled messages to store
  useEffect(() => {
    if (scheduledMessagesData) {
      const prev = getThreadStoreState().getScheduledMessagesForThread(threadId)
      const prevPending = prev.filter((m) => m.status === 'PENDING').length
      const nowPending = scheduledMessagesData.filter((m) => m.status === 'PENDING').length

      // If a scheduled message was just sent, refresh the message list
      if (nowPending < prevPending) {
        utils.message.listByThread.invalidate({ threadId })
      }

      getThreadStoreState().setScheduledMessages(
        scheduledMessagesData.map((m) => ({
          id: m.id,
          threadId: m.threadId,
          draftId: m.draftId,
          scheduledAt: m.scheduledAt.toISOString(),
          status: m.status,
          createdById: m.createdById,
          sendPayload: m.sendPayload as Record<string, unknown>,
          createdAt: m.createdAt.toISOString(),
        }))
      )
    }
  }, [scheduledMessagesData, threadId, utils])

  const portalTargetId = `reply-portal-${threadId}`

  // Check if there's a floating compose for this thread (for dock-back portal target)
  const floatingInstance = useComposeStore((s) =>
    s.instances.find((i) => i.thread?.id === threadId && i.displayMode === 'floating')
  )
  const hasFloatingCompose = !!floatingInstance

  const instances = useComposeStore((s) => s.instances)

  const {
    isOpen: isShowReplyBox,
    mode: editorMode,
    sourceMessage,
    ref: replyBoxRef,
    draft,
  } = replyBox

  // Open inline compose instance when reply box opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to isShowReplyBox and thread changes
  useEffect(() => {
    console.log('[ThreadDetails] replyBox effect', {
      isShowReplyBox,
      threadId: thread?.id,
      instanceId: instanceIdRef.current,
    })
    if (isShowReplyBox && thread) {
      // Skip if we already have a valid inline instance (e.g. adopted from dock-back)
      const existing = instanceIdRef.current
        ? instances.find((i) => i.id === instanceIdRef.current && i.displayMode === 'inline')
        : null
      if (existing) {
        console.log('[ThreadDetails] already have inline instance, skipping open', existing.id)
        return
      }

      // Close any previous instance for this thread
      if (instanceIdRef.current) {
        console.log('[ThreadDetails] closing previous instance', instanceIdRef.current)
        closeCompose(instanceIdRef.current)
      }
      const id = openInline({ mode: editorMode, thread, sourceMessage, draft }, portalTargetId)
      instanceIdRef.current = id
      justCreatedRef.current = true
    }

    if (!isShowReplyBox && instanceIdRef.current) {
      closeCompose(instanceIdRef.current)
      instanceIdRef.current = null
    }
  }, [isShowReplyBox, thread?.id])

  // Sync: if the compose instance disappears (user closed it), close the reply box
  useEffect(() => {
    // Skip if we just created the instance — the store hasn't propagated yet
    if (justCreatedRef.current) {
      justCreatedRef.current = false
      return
    }
    if (instanceIdRef.current && !instances.find((i) => i.id === instanceIdRef.current)) {
      instanceIdRef.current = null
      if (isShowReplyBox) {
        handlers.closeReplyBox()
      }
    }
  }, [instances, isShowReplyBox, handlers])

  // Adopt a floating instance that was docked back into this thread
  useEffect(() => {
    const docked = instances.find(
      (i) =>
        i.thread?.id === threadId && i.displayMode === 'inline' && i.id !== instanceIdRef.current
    )
    if (docked) {
      instanceIdRef.current = docked.id
      if (!isShowReplyBox) {
        handlers.openReplyBox('generic')
      }
    }
  }, [instances, threadId, isShowReplyBox, handlers])

  // Cleanup on unmount — only close inline instances, not popped-out floating ones
  const findByThread = useComposeStore((s) => s.findByThread)
  useEffect(() => {
    return () => {
      if (instanceIdRef.current) {
        const inst = findByThread(threadId)
        if (inst?.displayMode === 'inline') {
          closeCompose(instanceIdRef.current)
        }
        instanceIdRef.current = null
      }
    }
  }, [closeCompose, findByThread, threadId])

  // Resolve last message participants for hotkey handlers
  // (EmailDisplay does this per-message; we only need the last one for hotkeys)
  const lastMessage = messages.at(-1)
  const { from, to, cc } = useMessageParticipants(lastMessage?.participants ?? [])

  const lastEditorMessage: MessageType | null = useMemo(() => {
    if (!lastMessage) return null
    return {
      id: lastMessage.id,
      threadId: lastMessage.threadId,
      subject: lastMessage.subject,
      snippet: lastMessage.snippet,
      textHtml: lastMessage.textHtml,
      textPlain: lastMessage.textPlain,
      isInbound: lastMessage.isInbound,
      sentAt: lastMessage.sentAt ? new Date(lastMessage.sentAt) : null,
      createdAt: new Date(lastMessage.createdAt),
      messageType: lastMessage.messageType as MessageType['messageType'],
      from: from
        ? {
            id: from.id,
            identifier: from.identifier,
            identifierType: from.identifierType,
            name: from.name,
            displayName: from.displayName,
          }
        : null,
      participants: [
        ...(from
          ? [
              {
                role: 'FROM',
                participant: {
                  id: from.id,
                  identifier: from.identifier,
                  identifierType: from.identifierType,
                  name: from.name,
                },
              },
            ]
          : []),
        ...to.map((p) => ({
          role: 'TO',
          participant: {
            id: p.id,
            identifier: p.identifier,
            identifierType: p.identifierType,
            name: p.name,
          },
        })),
        ...cc.map((p) => ({
          role: 'CC',
          participant: {
            id: p.id,
            identifier: p.identifier,
            identifierType: p.identifierType,
            name: p.name,
          },
        })),
      ],
    }
  }, [lastMessage, from, to, cc])

  // Keyboard shortcuts: R to reply, F to forward the last message
  useHotkey(
    'R',
    () => {
      if (lastEditorMessage) emailActions.onReplyAll(lastEditorMessage)
    },
    { enabled: !!thread && !isShowReplyBox, conflictBehavior: 'allow' }
  )

  useHotkey(
    'F',
    () => {
      if (lastEditorMessage) emailActions.onForward(lastEditorMessage)
    },
    { enabled: !!thread && !isShowReplyBox, conflictBehavior: 'allow' }
  )

  if (!thread) {
    if (isLoading) {
      return (
        <div className='flex h-full items-center justify-center'>
          <div className='h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent'></div>
        </div>
      )
    }
    if (isNotFound) {
      return (
        <div className='flex h-full items-center justify-center'>
          <div className='text-red-500'>Thread not found</div>
        </div>
      )
    }
    return null
  }

  return (
    <ScrollArea className='relative flex h-full flex-col flex-1 w-full' scrollbarClassName='w-1!'>
      <div className={cn('flex flex-1 flex-col', centered && 'mx-auto w-full max-w-4xl')}>
        <ThreadHeader />

        <div className='flex-1 '>
          <ThreadMessages />

          <div className='px-4 pb-6 pt-4 md:px-6 md:pb-10'>
            <CommentList recordId={toRecordId('thread', thread.id)} />
          </div>

          <div className='grow'></div>
        </div>

        {/* Reply editor portal target — the editor renders here via portal when docked */}
        <div ref={replyBoxRef} className=''>
          {(isShowReplyBox || hasFloatingCompose) && (
            <div className='px-4 py-4 pb-[90px]'>
              <div id={portalTargetId} />
            </div>
          )}
        </div>

        <ThreadFooter />
      </div>
    </ScrollArea>
  )
}
