// ~/app/(protected)/app/contacts/_components/use-contact-mutations.tsx
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'

interface UseContactMutationsOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Custom hook that provides all contact-related mutations
 * @param options - Optional callbacks for success and error handling
 * @returns Object containing all mutation functions
 */
export function useContactMutations(options?: UseContactMutationsOptions) {
  const utils = api.useUtils()
  const { onRecordUpdated, onRecordDeleted, onBulkUpdated, onBulkDeleted, onRecordCreated } =
    useRecordInvalidation()

  // Mark contact as spam mutation
  const markAsSpam = api.contact.markAsSpam.useMutation({
    onSuccess: (_, { id }) => {
      onRecordUpdated('contact', id)
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error marking as spam',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Bulk mark contacts as spam mutation
  const bulkMarkAsSpam = api.contact.bulkMarkAsSpam.useMutation({
    onSuccess: (data, { ids }) => {
      onBulkUpdated('contact', ids)
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error marking contacts as spam',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Delete contact mutation
  const deleteContact = api.contact.deleteContact.useMutation({
    onSuccess: (_, { id }) => {
      onRecordDeleted('contact', id)
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error deleting contact',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Bulk delete contacts mutation
  const bulkDeleteContacts = api.contact.bulkDelete.useMutation({
    onSuccess: (_, { ids }) => {
      onBulkDeleted('contact', ids)
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error deleting contacts',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Create contact mutation
  const createContact = api.contact.create.useMutation({
    onSuccess: () => {
      onRecordCreated('contact')
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error creating contact',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Update contact mutation
  const updateContact = api.contact.update.useMutation({
    onSuccess: (_, { id }) => {
      onRecordUpdated('contact', id)
      utils.contact.getAll.invalidate()
      utils.contact.getById.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error updating contact',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Add contacts to group mutation
  const addToGroup = api.contact.addToGroup.useMutation({
    onSuccess: (_, { contactIds }) => {
      onBulkUpdated('contact', contactIds)
      utils.contact.getAll.invalidate()
      utils.contact.getGroups.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error adding to group',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Remove contacts from group mutation
  const removeFromGroup = api.contact.removeFromGroup.useMutation({
    onSuccess: (_, { contactIds }) => {
      onBulkUpdated('contact', contactIds)
      utils.contact.getAll.invalidate()
      utils.contact.getGroups.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error removing from group',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Create group mutation
  const createGroup = api.contact.createGroup.useMutation({
    onSuccess: () => {
      utils.contact.getGroups.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error creating group',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Update group mutation
  const updateGroup = api.contact.updateGroup.useMutation({
    onSuccess: () => {
      utils.contact.getGroups.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error updating group',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  return {
    // Contact mutations
    markAsSpam,
    bulkMarkAsSpam,
    deleteContact,
    bulkDeleteContacts,
    createContact,
    updateContact,

    // Group mutations
    addToGroup,
    removeFromGroup,
    createGroup,
    updateGroup,

    // Mutation states
    isLoading:
      markAsSpam.isPending ||
      bulkMarkAsSpam.isPending ||
      deleteContact.isPending ||
      bulkDeleteContacts.isPending ||
      createContact.isPending ||
      updateContact.isPending ||
      addToGroup.isPending ||
      removeFromGroup.isPending ||
      createGroup.isPending ||
      updateGroup.isPending,
  }
}
