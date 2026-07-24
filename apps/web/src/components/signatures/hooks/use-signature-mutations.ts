// apps/web/src/components/signatures/hooks/use-signature-mutations.ts

import type { SignatureVisibility } from '@auxx/types/signature'
import { toastError } from '@auxx/ui/components/toast'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
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

  // Canonical create hook — seeds record + field-value caches and toasts on
  // error. The signature list reads from `record.listAll`, so onCreated still
  // invalidates it (seeding can't add listAll membership); the seed keeps
  // recordId-keyed consumers instant.
  const { create: createRecord, isPending: isCreating } = useCreateRecord({
    entityDefinitionId: 'signature',
    onCreated: () => {
      posthog?.capture('signature_created')
      invalidateSignatures()
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
     * Create a new signature.
     * Field keys must match each field's `systemAttribute` (see SIGNATURE_FIELDS) —
     * the entity-system setFieldValues lookup is keyed by systemAttribute.
     */
    create: (input: CreateSignatureInput) =>
      createRecord({
        values: {
          signature_name: input.name,
          signature_body: input.body,
          signature_is_default: input.isDefault ?? false,
          signature_visibility: input.visibility ?? 'private',
        },
      }),

    /**
     * Update an existing signature
     */
    update: (recordId: string, input: UpdateSignatureInput) => {
      const values: Record<string, unknown> = {}
      if (input.name !== undefined) values.signature_name = input.name
      if (input.body !== undefined) values.signature_body = input.body
      if (input.isDefault !== undefined) values.signature_is_default = input.isDefault
      if (input.visibility !== undefined) values.signature_visibility = input.visibility
      return updateSignature.mutateAsync({ recordId, values })
    },

    /**
     * Delete a signature
     */
    delete: (recordId: string) => deleteSignature.mutateAsync({ recordId }),

    /** Raw mutations for custom handling */
    updateSignature,
    deleteSignature,

    /** Loading states */
    isCreating,
    isUpdating: updateSignature.isPending,
    isDeleting: deleteSignature.isPending,
    isPending: isCreating || updateSignature.isPending || deleteSignature.isPending,
  }
}
