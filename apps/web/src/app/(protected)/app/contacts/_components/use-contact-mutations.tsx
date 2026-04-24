// ~/app/(protected)/app/contacts/_components/use-contact-mutations.tsx

import { toastError } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'
import { api } from '~/trpc/react'

interface UseContactMutationsOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Custom hook that provides contact mutations.
 * Most contact CRUD goes through the generic entity path (`api.record.*`);
 * only mark-as-spam remains specialised here.
 */
export function useContactMutations(options?: UseContactMutationsOptions) {
  const { onRecordUpdated } = useRecordInvalidation()

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

  return {
    markAsSpam,
    isLoading: markAsSpam.isPending,
  }
}
