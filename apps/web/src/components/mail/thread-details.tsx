// src/components/mail/thread-details.tsx
'use client'

import { toRecordId } from '@auxx/lib/field-values/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area-v2'
import { useEffect, useRef } from 'react'
import { useThread } from '~/components/threads/hooks'
import { useCompose } from '~/hooks/use-compose'
import { CommentList } from '../global/comments/comment-list'
import { useComposeStore } from './store/compose-store'
import { ThreadFooter } from './thread-footer'
import { ThreadHeader } from './thread-header'
import { ThreadMessages } from './thread-messages'
import { useThreadContext } from './thread-provider'

/**
 * Main component for displaying thread details.
 * Includes messages, reply functionality, and comments.
 */
export default function ThreadDetails() {
  const { threadId, replyBox, handlers } = useThreadContext()
  const { thread, isLoading, isNotFound } = useThread({ threadId })
  const { openInline, close: closeCompose } = useCompose()
  const instanceIdRef = useRef<string | null>(null)
  const justCreatedRef = useRef(false)

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
    <ScrollArea className='relative flex h-full flex-col flex-1 w-full'>
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
    </ScrollArea>
  )
}
