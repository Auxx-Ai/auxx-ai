// apps/web/src/components/signatures/hooks/use-signature-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

/** Input for creating a signature. Name + body are the whole surface. */
interface CreateSignatureInput {
  name: string
  body: string
}

/** Input for updating a signature. Omitted keys are left untouched. */
interface UpdateSignatureInput {
  name?: string
  body?: string
}

/**
 * Signature CRUD, on the dedicated `signature.*` router (plan 36 §3/§5).
 *
 * Three things changed with the router:
 *  1. Everything is keyed by the signature **`id`** (`EntityInstance.id`), not a
 *     `recordId` — `record.update`/`record.delete` are closed to instance-access
 *     defs and would throw `ForbiddenError`.
 *  2. `visibility` and `isDefault` are gone from the write path. Migration 057
 *     deleted both fields; sharing goes through `resourceAccess.grantInstance`
 *     (see `InstanceShareDialog`) and "default" through {@link setDefault}.
 *  3. `setDefault` writes only the CALLER's `UserSetting` row. The old
 *     "unset the current default on someone else's record first" dance is gone —
 *     it was a cross-member write that 403s under instance access.
 *
 * @example
 * ```tsx
 * const { create, update, delete: remove, setDefault } = useSignatureMutations()
 * await create({ name: 'My Signature', body: '<p>Thanks!</p>' })
 * await update(signature.id, { name: 'Updated Name' })
 * await setDefault(signature.id)
 * ```
 */
export function useSignatureMutations() {
  const utils = api.useUtils()
  const posthog = useAnalytics()

  /** The list is the only signature query that can gain/lose rows. */
  const invalidateSignatures = () => {
    void utils.signature.list.invalidate()
  }

  /**
   * Delete and setDefault both move the caller's `signature.defaultId` pointer
   * (delete clears it server-side when it named the deleted signature).
   */
  const invalidateDefault = () => {
    void utils.signature.getDefault.invalidate()
  }

  const createSignature = api.signature.create.useMutation({
    onSuccess: () => {
      posthog?.capture('signature_created')
      invalidateSignatures()
    },
    onError: (error) => {
      toastError({ title: 'Error creating signature', description: error.message })
    },
  })

  const updateSignature = api.signature.update.useMutation({
    onSuccess: invalidateSignatures,
    onError: (error) => {
      toastError({ title: 'Error updating signature', description: error.message })
    },
  })

  const deleteSignature = api.signature.delete.useMutation({
    onSuccess: () => {
      invalidateSignatures()
      invalidateDefault()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting signature', description: error.message })
    },
  })

  const setDefaultSignature = api.signature.setDefault.useMutation({
    onSuccess: invalidateDefault,
    onError: (error) => {
      toastError({ title: 'Error setting default signature', description: error.message })
    },
  })

  return {
    /** Create a signature. The creator gets the owner `admin` grant server-side. */
    create: (input: CreateSignatureInput) => createSignature.mutateAsync(input),

    /** Update a signature by its `EntityInstance.id`. */
    update: (id: string, input: UpdateSignatureInput) =>
      updateSignature.mutateAsync({ id, ...input }),

    /** Delete a signature by its `EntityInstance.id`. */
    delete: (id: string) => deleteSignature.mutateAsync({ id }),

    /** Point the CALLER's default at `id`, or clear it with `null`. */
    setDefault: (id: string | null) => setDefaultSignature.mutateAsync({ id }),

    /** Raw mutations for custom handling. */
    createSignature,
    updateSignature,
    deleteSignature,
    setDefaultSignature,

    /** Loading states. */
    isCreating: createSignature.isPending,
    isUpdating: updateSignature.isPending,
    isDeleting: deleteSignature.isPending,
    isSettingDefault: setDefaultSignature.isPending,
    isPending:
      createSignature.isPending ||
      updateSignature.isPending ||
      deleteSignature.isPending ||
      setDefaultSignature.isPending,
  }
}
