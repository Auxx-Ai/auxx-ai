// apps/web/src/components/threads/hooks/use-inbox-mutations.ts

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * Hook for inbox mutation operations.
 * Provides create, update, delete, and integration management.
 */
export function useInboxMutations() {
  const utils = api.useUtils()

  /** Invalidate inbox queries after mutations */
  const invalidateInboxes = () => {
    utils.inbox.getAll.invalidate()
    utils.record.listAll.invalidate({ entityDefinitionId: 'inbox' })
  }

  const createInbox = api.inbox.create.useMutation({
    onSuccess: () => {
      invalidateInboxes()
    },
    onError: (error) => {
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })

  const updateInbox = api.inbox.update.useMutation({
    onSuccess: () => {
      invalidateInboxes()
    },
    onError: (error) => {
      toastError({ title: 'Error updating inbox', description: error.message })
    },
  })

  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      invalidateInboxes()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  const addIntegration = api.inbox.addIntegration.useMutation({
    onSuccess: () => {
      invalidateInboxes()
    },
    onError: (error) => {
      toastError({ title: 'Error adding integration', description: error.message })
    },
  })

  const removeIntegration = api.inbox.removeIntegration.useMutation({
    onSuccess: () => {
      invalidateInboxes()
    },
    onError: (error) => {
      toastError({ title: 'Error removing integration', description: error.message })
    },
  })

  return {
    createInbox,
    updateInbox,
    deleteInbox,
    addIntegration,
    removeIntegration,
  }
}
