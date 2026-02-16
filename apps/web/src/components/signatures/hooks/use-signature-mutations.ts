// apps/web/src/components/signatures/hooks/use-signature-mutations.ts

import type { SignatureVisibility } from '@auxx/types/signature'
import { toastError } from '@auxx/ui/components/toast'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

/**
 * Input for creating a signature
 */
interface CreateSignatureInput {
  name: string
  body: string
  isDefault?: boolean
  visibility?: SignatureVisibility
}

/**
 * Input for updating a signature
 */
interface UpdateSignatureInput {
  name?: string
  body?: string
  isDefault?: boolean
  visibility?: SignatureVisibility
}

/**
 * Hook for signature mutation operations.
 * Uses the generic record router for CRUD.
 *
 * @example
 * ```tsx
 * const { create, update, delete: deleteSignature, isPending } = useSignatureMutations()
 *
 * // Create new signature
 * await create({ name: 'My Signature', body: '<p>Thanks!</p>' })
 *
 * // Update existing signature
 * await update(recordId, { name: 'Updated Name' })
 *
 * // Delete signature
 * await deleteSignature(recordId)
 * ```
 */
export function useSignatureMutations() {
  const utils = api.useUtils()
  const posthog = useAnalytics()

  /** Invalidate signature queries after mutations */
  const invalidateSignatures = () => {
    utils.record.listAll.invalidate({ entityDefinitionId: 'signature' })
  }

  const createSignature = api.record.create.useMutation({
    onSuccess: () => {
      posthog?.capture('signature_created')
      invalidateSignatures()
    },
    onError: (error) => {
      toastError({ title: 'Error creating signature', description: error.message })
    },
  })

  const updateSignature = api.record.update.useMutation({
    onSuccess: () => {
      invalidateSignatures()
    },
    onError: (error) => {
      toastError({ title: 'Error updating signature', description: error.message })
    },
  })

  const deleteSignature = api.record.delete.useMutation({
    onSuccess: () => {
      invalidateSignatures()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting signature', description: error.message })
    },
  })

  return {
    /**
     * Create a new signature
     */
    create: (input: CreateSignatureInput) =>
      createSignature.mutateAsync({
        entityDefinitionId: 'signature',
        values: {
          name: input.name,
          body: input.body,
          isDefault: input.isDefault ?? false,
          visibility: input.visibility ?? 'private',
        },
      }),

    /**
     * Update an existing signature
     */
    update: (recordId: string, input: UpdateSignatureInput) =>
      updateSignature.mutateAsync({
        recordId,
        values: input,
      }),

    /**
     * Delete a signature
     */
    delete: (recordId: string) => deleteSignature.mutateAsync({ recordId }),

    /** Raw mutations for custom handling */
    createSignature,
    updateSignature,
    deleteSignature,

    /** Loading states */
    isCreating: createSignature.isPending,
    isUpdating: updateSignature.isPending,
    isDeleting: deleteSignature.isPending,
    isPending: createSignature.isPending || updateSignature.isPending || deleteSignature.isPending,
  }
}
