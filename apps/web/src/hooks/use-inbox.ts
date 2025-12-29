// ~/hooks/use-inbox.ts
import { api } from '~/trpc/react'
import { useState } from 'react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

export const useInbox = () => {
  const [isLoading] = useState(false)

  // Get all inboxes for the organization
  const { data: inboxes, refetch: refetchInboxes } = api.inbox.getAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 10,
  })

  // Get inboxes for the current user
  const { data: userInboxes, refetch: refetchUserInboxes } = api.inbox.getUserInboxes.useQuery()

  // Create inbox mutation
  const createInbox = api.inbox.create.useMutation({
    onSuccess: () => {
      refetchInboxes()
      refetchUserInboxes()
      toastSuccess({ title: 'Inbox created', description: 'Your inbox was created successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error creating inbox', description: error.message })
    },
  })

  // Update inbox mutation
  const updateInbox = api.inbox.update.useMutation({
    onSuccess: () => {
      refetchInboxes()
      refetchUserInboxes()
      toastSuccess({ title: 'Inbox updated', description: 'Your inbox was updated successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error updating inbox', description: error.message })
    },
  })

  // Delete inbox mutation
  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      refetchInboxes()
      refetchUserInboxes()
      toastSuccess({ title: 'Inbox deleted', description: 'Your inbox was deleted successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  const addIntegration = api.inbox.addIntegration.useMutation({
    onSuccess: () => {
      refetchInboxes()
      refetchUserInboxes()
      toastSuccess({
        title: 'Integration added',
        description: 'Your integration was added successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error adding integration', description: error.message })
    },
  })
  const removeIntegration = api.inbox.removeIntegration.useMutation({
    onSuccess: () => {
      refetchInboxes()
      refetchUserInboxes()
      toastSuccess({
        title: 'Integration removed',
        description: 'Your integration was removed successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error removing integration', description: error.message })
    },
  })

  return {
    inboxes,
    userInboxes,
    isLoading,
    createInbox,
    updateInbox,
    deleteInbox,
    refetchInboxes,
    refetchUserInboxes,
    addIntegration,
    removeIntegration,
  }
}
