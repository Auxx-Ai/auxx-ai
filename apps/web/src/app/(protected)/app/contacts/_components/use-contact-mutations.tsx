// ~/app/(protected)/app/contacts/_components/use-contact-mutations.tsx

import { toastError } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'
import { api } from '~/trpc/react'

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

  // TODO: Group mutations (addToGroup, removeFromGroup, createGroup, updateGroup) removed.
  // CustomerGroup/CustomerGroupMember tables have been deleted.
  // Groups are now managed via entity-group-member table.

  return {
    // Contact mutations
    markAsSpam,
    bulkMarkAsSpam,
    deleteContact,
    bulkDeleteContacts,
    createContact,
    updateContact,

    // Mutation states
    isLoading:
      markAsSpam.isPending ||
      bulkMarkAsSpam.isPending ||
      deleteContact.isPending ||
      bulkDeleteContacts.isPending ||
      createContact.isPending ||
      updateContact.isPending,
  }
}
