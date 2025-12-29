// src/hooks/use-thread-mutations.tsx

import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

/**
 * Custom hook that provides thread-related mutations with optimistic updates
 * @param threadId The ID of the current thread
 * @param contextParams Filter parameters for list invalidation
 * @returns Object containing mutation functions and their states
 */
export function useThreadMutations(
  threadId: string,
  contextParams: {
    contextType:
      | 'sent'
      | 'tag'
      | 'all'
      | 'personal_assigned'
      | 'personal_inbox'
      | 'drafts'
      | 'view'
      | 'all_inboxes'
      | 'specific_inbox'
      | string
    contextId?: string
    statusSlug?: string
    searchQuery?: string
  }
) {
  const { contextType, contextId, statusSlug, searchQuery } = contextParams
  const utils = api.useUtils()

  // Create invalidation function
  const invalidateQueries = () => {
    utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
    utils.thread.getCounts.invalidate()
    utils.thread.getById.invalidate({ threadId })
  }

  // Simple tRPC mutations for now - will add optimistic updates later
  const archiveThread = api.thread.archive.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread archived' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  const unarchiveThread = api.thread.unarchive.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread restored' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to restore', description: error.message })
    },
  })

  const moveToTrash = api.thread.moveToTrash.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread moved to trash' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to move to trash', description: error.message })
    },
  })

  const updateAssignee = api.thread.assign.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Assignee updated' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update assignee', description: error.message })
    },
  })

  const updateSubject = api.thread.updateSubject.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Subject updated' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update subject', description: error.message })
    },
  })

  const moveBulkToInbox = api.thread.moveBulkToInbox.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread moved to inbox' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to move to inbox', description: error.message })
    },
  })

  const markReadMutation = api.thread.markAsRead.useMutation({
    onSuccess: () => {
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to mark as read', description: error.message })
    },
  })

  const markAsSpam = api.thread.markAsSpam.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread marked as spam' })
      invalidateQueries()
    },
    onError: (error) => toastError({ title: 'Failed to mark as spam', description: error.message }),
  })

  const deletePermanently = api.thread.deletePermanently.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Thread permanently deleted' })
      invalidateQueries()
    },
    onError: (error) => {
      toastError({ title: 'Failed to permanently delete thread' })
    },
  })

  return {
    archiveThread,
    unarchiveThread,
    moveToTrash,
    updateAssignee,
    updateSubject,
    moveBulkToInbox,
    markReadMutation,
    markAsSpam,
    deletePermanently,
  }
}
