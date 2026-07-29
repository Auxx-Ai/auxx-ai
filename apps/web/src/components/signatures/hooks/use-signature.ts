// apps/web/src/components/signatures/hooks/use-signature.ts
'use client'

import { toRecordId } from '@auxx/types/resource'
import type { SignatureItem } from '@auxx/types/signature'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** Result from {@link useSignatures}. */
interface UseSignaturesResult {
  /** Every signature the current member may VIEW, oldest first. */
  signatures: SignatureItem[]
  /** `id` → signature, for the id-keyed consumers (composer, picker, editor). */
  signatureMap: Map<string, SignatureItem>
  isLoading: boolean
  /** Refetch the list. */
  refresh: () => void
}

/**
 * Every signature the caller may see.
 *
 * Reads the DEDICATED `signature.list` router (plan 36 §3, recommendation (a)),
 * not `useAllRecords({ entityDefinitionId: 'signature' })` — `record.*` now
 * refuses every instance-access def outright (`assertNotInstanceAccessDef`), so
 * the old generic path throws `ForbiddenError` at runtime. `signature.list`
 * FILTERS to the member's own `view` grants in SQL rather than 403-ing, so this
 * hook simply returns a shorter list for a member with fewer grants.
 *
 * The old hook also returned `records` + `fields` (raw `RecordMeta` and the
 * entity-system field map). Both are gone: nothing consumed them (grep-verified
 * in plan 36 §12.1), which is exactly why the dedicated router was chosen.
 *
 * @example
 * ```tsx
 * const { signatures, isLoading } = useSignatures()
 * ```
 */
export function useSignatures(): UseSignaturesResult {
  const { data, isLoading, refetch } = api.signature.list.useQuery()

  const { signatures, signatureMap } = useMemo(() => {
    const items: SignatureItem[] = (data ?? []).map((signature) => ({
      id: signature.id,
      // Re-branded rather than passed through: the router emits the same
      // `signature:<id>` string, but as a plain `string` over the wire.
      recordId: toRecordId('signature', signature.id),
      name: signature.name,
      body: signature.body,
      createdById: signature.createdById,
    }))
    return {
      signatures: items,
      signatureMap: new Map<string, SignatureItem>(items.map((item) => [item.id, item])),
    }
  }, [data])

  return { signatures, signatureMap, isLoading, refresh: () => void refetch() }
}

/**
 * One signature by id, resolved out of the list the caller may see.
 *
 * Deliberately NOT `signature.get`: every consumer already mounts the list, and
 * a miss here means "not visible to you or deleted" — which is what the callers
 * (the form's not-found guard, the composer panel) want to branch on anyway.
 *
 * @param signatureId - the `EntityInstance.id`, or null/undefined for none
 */
export function useSignature(signatureId: string | null | undefined) {
  const { signatureMap, isLoading } = useSignatures()

  const signature = useMemo(() => {
    if (!signatureId) return undefined
    return signatureMap.get(signatureId)
  }, [signatureId, signatureMap])

  return { signature, isLoading }
}

/**
 * The CALLER's default signature (plan 36 §12.2).
 *
 * Per-user, not per-org: the pointer lives in `UserSetting`
 * (`signature.defaultId`) and `signature.getDefault` re-checks `canViewInstance`
 * on read, so a signature that was deleted or un-shared after being defaulted
 * degrades to "no default" instead of handing the composer an id it would 403
 * on. The old org-global `signature_is_default` FieldValue is gone.
 */
export function useDefaultSignature() {
  const { data: defaultId, isLoading: isLoadingDefault } = api.signature.getDefault.useQuery()
  const { signatureMap, isLoading: isLoadingList } = useSignatures()

  const signature = useMemo(
    () => (defaultId ? signatureMap.get(defaultId) : undefined),
    [defaultId, signatureMap]
  )

  return {
    signature,
    /** The stored pointer, even if it resolves to nothing in this list. */
    defaultId: defaultId ?? null,
    isLoading: isLoadingList || isLoadingDefault,
  }
}
