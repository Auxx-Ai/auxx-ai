// src/components/mail/thread-details.tsx
'use client'

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

// Import custom hooks
import { useConfirm } from '~/hooks/use-confirm'
import { useThread } from './thread-provider'

// Import components
import { ThreadHeader } from './thread-header'
import { ThreadMessages } from './thread-messages'
import { ThreadFooter } from './thread-footer'
import { CommentList } from '../global/comments/comment-list'
import ReplyComposeEditor from './email-editor' // Renamed import

/**
 * Main component for displaying thread details
 * Includes messages, reply functionality, and comments
 */
export default function ThreadDetails() {
  const router = useRouter()
  // const { data: session } = useSession()
  const [confirm, ConfirmDialog] = useConfirm()

  // Get all thread data and actions from context
  const {
    thread,
    isLoading,
    error,
    isDone,
    assignee,
    replyBox,
    mutations,
    handlers,
    emailActions,
  } = useThread()

  // Define all callbacks first (before early returns)
  // const handleRule = useCallback(() => {
  //   setIsRuleTestDialogOpen(true)
  // }, [])

  // const handleRuleTest = useCallback(
  //   async (ruleId: string, mode: 'test' | 'run') => {
  //     try {
  //       await emailActions.onRule(ruleId, mode)
  //     } catch (error) {
  //       console.error('Rule test failed:', error)
  //       throw error // Re-throw so the dialog can handle it
  //     }
  //   },
  //   [emailActions]
  // )

  // --- Action Handlers ---
  const handleMarkDone = useCallback(async () => {
    if (!thread) return
    await handlers.updateStatus(!isDone)
  }, [thread, isDone, handlers])

  const handleMarkTrash = useCallback(async () => {
    if (!thread) return
    console.log('Attempting to move thread to trash', { threadId: thread.id })

    const confirmed = await confirm({
      title: 'Move to trash?',
      description: 'This thread will be moved to trash. You can restore it later if needed.',
      confirmText: 'Move to trash',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.moveToTrash()
        toastSuccess({ title: 'Thread moved to trash' })
      } catch (error) {
        toastError({ title: 'Failed to move thread to trash' })
      }
    }
  }, [thread, mutations, confirm])

  const handleMarkSpam = useCallback(async () => {
    if (!thread) return
    console.log('Attempting to mark thread as spam', { threadId: thread.id })

    const confirmed = await confirm({
      title: 'Mark as spam?',
      description: 'This thread will be marked as spam and moved to the spam folder.',
      confirmText: 'Mark as spam',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.markAsSpam()
        toastSuccess({ title: 'Thread marked as spam' })
      } catch (error) {
        toastError({ title: 'Failed to mark thread as spam' })
      }
    }
  }, [thread, mutations, confirm])

  const handleAssigneeChange = useCallback(
    async (selectedAssignees: any[] | null) => {
      if (!thread) return
      // Type might need adjustment based on picker component
      const firstAssignee =
        Array.isArray(selectedAssignees) && selectedAssignees.length > 0
          ? selectedAssignees[0]
          : null
      const newAssigneeId = firstAssignee?.id ?? null // Use optional chaining and nullish coalescing

      // Avoid mutation if assignee hasn't changed
      if (newAssigneeId === (assignee?.id ?? null)) {
        console.log('Assignee unchanged, skipping update.', { newAssigneeId })
        return
      }

      await handlers.updateAssignee(newAssigneeId)
    },
    [thread, assignee, handlers]
  )

  const handleChangeSubject = useCallback(
    async (newSubject: string) => {
      if (!thread) return
      const trimmedSubject = newSubject.trim()
      if (thread.subject === trimmedSubject || !trimmedSubject) {
        console.log('Subject unchanged or empty, skipping update.', {
          oldSubject: thread.subject,
          newSubject,
        })
        return // No change or empty subject
      }
      await handlers.updateSubject(trimmedSubject)
    },
    [thread, handlers]
  )

  const handleInboxChange = useCallback(
    async (selectedInboxIds: string[]) => {
      if (!thread) return
      // Assuming picker returns array of IDs
      const targetInboxId = selectedInboxIds?.[0]
      if (!targetInboxId || targetInboxId === thread.inboxId) {
        return
      }

      await handlers.moveToInbox(targetInboxId)
    },
    [thread, handlers]
  )

  const handlePermanentlyDelete = useCallback(async () => {
    if (!thread) return
    console.log('Attempting to permanently delete thread', { threadId: thread.id })

    const confirmed = await confirm({
      title: 'Permanently delete thread?',
      description:
        'This action cannot be undone. The thread and all its messages will be permanently removed.',
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.deletePermanently()
        // Navigate back to the mail list view after successful deletion
        // router.push('/app/mail')
      } catch (error) {
        console.log('Permanent delete failed:', { error, threadId: thread.id })
      }
    }
  }, [thread, mutations, router, confirm])

  // Early return if no thread
  if (!thread) {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-red-500">Error loading thread: {error.message}</div>
        </div>
      )
    }
    return null
  }

  // Get specific data from context
  const { isOpen: isShowReplyBox, mode: editorMode, sourceMessage, ref: replyBoxRef } = replyBox

  // Render
  return (
    <>
      <ConfirmDialog />
      <div className="relative flex h-full flex-col overflow-y-auto overflow-x-hidden flex-1 w-full">
        {/* Thread header with actions */}
        <ThreadHeader
          onSubjectChange={handleChangeSubject}
          onAssigneeChange={handleAssigneeChange}
          onMarkDone={handleMarkDone}
          onMarkTrash={handleMarkTrash}
          onMarkSpam={handleMarkSpam}
          onInboxChange={handleInboxChange}
          onPermanentlyDelete={handlePermanentlyDelete}
        />

        {/* Scrollable content area */}
        <div className="flex-1 ">
          {/* Render Sent Messages */}
          <ThreadMessages />

          {/* Comments Section */}
          <div className="px-4 pb-6 pt-4 md:px-6 md:pb-10">
            <CommentList
              entityId={thread.id}
              entityType="Thread"
              initialComments={thread.comments} // Pass comments fetched with thread
            />
          </div>

          <div className="grow"></div>
        </div>
        {/* Reply/Compose Editor Area */}
        <div ref={replyBoxRef} className="">
          {/* Make it sticky */}
          {isShowReplyBox && ( // Render only if shown and inboxId is known
            <div className="px-4 py-4 pb-[90px]">
              <ReplyComposeEditor
                // Use a key that changes when the fundamental context changes
                key={`${thread.id}-${editorMode}-${sourceMessage?.id ?? 'new'}`}
                mode={editorMode}
                sourceMessage={sourceMessage} // Pass the message being replied/forwarded to
                thread={thread}
                draftMessage={thread.draftMessage} // Pass the draft message from the thread query
                onClose={() => handlers.closeReplyBox()}
                onSendSuccess={() => {
                  console.log('onSendSuccess callback triggered')
                  // Invalidation already happens in the mutation's onSuccess
                  // handlers.closeReplyBox(); // Close the box after sending
                }}
              />
            </div>
          )}
        </div>
        <ThreadFooter />
      </div>
    </>
  )
}
