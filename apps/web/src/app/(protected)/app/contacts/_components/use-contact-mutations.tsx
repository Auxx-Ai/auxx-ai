// ~/app/(protected)/app/contacts/_components/use-contact-mutations.tsx
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()
  const utils = api.useUtils()

  // Mark contact as spam mutation
  const markAsSpam = api.contact.markAsSpam.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Contact marked as spam',
        description: 'The contact has been marked as spam successfully',
      })
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
    onSuccess: (data) => {
      toastSuccess({
        title: 'Contacts marked as spam',
        description: `${data.count} contact${data.count > 1 ? 's have' : ' has'} been marked as spam successfully`,
      })
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
    onSuccess: () => {
      toastSuccess({
        title: 'Contact deleted',
        description: 'The contact has been deleted successfully',
      })
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
    onSuccess: (data) => {
      toastSuccess({
        title: 'Contacts deleted',
        description: `${data.count} contact${data.count > 1 ? 's' : ''} deleted successfully`,
      })
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
      toastSuccess({
        title: 'Contact created',
        description: 'New contact has been created successfully',
      })
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
    onSuccess: () => {
      toastSuccess({
        title: 'Contact updated',
        description: 'Contact has been updated successfully',
      })
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

  // Merge contacts mutation
  const mergeContacts = api.contact.mergeCustomers.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Contacts merged',
        description: 'Contacts have been merged successfully',
      })
      utils.contact.getAll.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error merging contacts',
        description: error.message,
      })
      options?.onError?.(error)
    },
  })

  // Add contacts to group mutation
  const addToGroup = api.contact.addToGroup.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Added to group',
        description: 'Contacts have been added to the group successfully',
      })
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
    onSuccess: () => {
      toastSuccess({
        title: 'Removed from group',
        description: 'Contacts have been removed from the group successfully',
      })
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
      toastSuccess({
        title: 'Group created',
        description: 'New group has been created successfully',
      })
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
      toastSuccess({
        title: 'Group updated',
        description: 'Group has been updated successfully',
      })
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
    mergeContacts,

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
      mergeContacts.isPending ||
      addToGroup.isPending ||
      removeFromGroup.isPending ||
      createGroup.isPending ||
      updateGroup.isPending,
  }
}
