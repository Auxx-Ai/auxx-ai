// apps/web/src/components/signatures/hooks/use-signature.ts

import { useMemo } from 'react'
import type { SignatureItem, SignatureVisibility } from '@auxx/types/signature'
import { useAllRecords, type FieldInfo } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/**
 * Extended RecordMeta with signature-specific field values
 */
interface SignatureRecordMeta extends RecordMeta {
  fieldValues: {
    name?: string
    body?: string
    isDefault?: boolean
    visibility?: SignatureVisibility
    createdById?: string
  }
}

/**
 * Result from useSignatures hook
 */
interface UseSignaturesResult {
  /** All signatures */
  signatures: SignatureItem[]
  /** Raw records from store */
  records: SignatureRecordMeta[]
  /** Map of id to signature for quick lookups */
  signatureMap: Map<string, SignatureItem>
  /** Field key to info mapping */
  fields: Record<string, FieldInfo>
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refetch signatures */
  refresh: () => void
}

/**
 * Hook to fetch all signatures using the entity system.
 * Replaces multiple tRPC calls with a single useAllRecords call.
 *
 * @example
 * ```tsx
 * const { signatures, isLoading } = useSignatures()
 * ```
 */
export function useSignatures(): UseSignaturesResult {
  const { records, fields, isLoading, error, refresh } = useAllRecords<SignatureRecordMeta>({
    entityDefinitionId: 'signature',
  })

  const { signatures, signatureMap } = useMemo(() => {
    if (!records.length) {
      return { signatures: [], signatureMap: new Map<string, SignatureItem>() }
    }

    const items: SignatureItem[] = records.map((record) => {
      // Handle visibility being returned as array from entity system
      const rawVisibility = record.fieldValues?.visibility
      const visibility: SignatureVisibility = Array.isArray(rawVisibility)
        ? rawVisibility[0] ?? 'private'
        : rawVisibility ?? 'private'

      return {
        id: record.id,
        recordId: record.recordId,
        name: record.fieldValues?.name ?? record.displayName ?? 'Untitled',
        body: record.fieldValues?.body ?? '',
        isDefault: record.fieldValues?.isDefault ?? false,
        visibility,
        createdById: record.fieldValues?.createdById,
      }
    })

    const map = new Map<string, SignatureItem>(items.map((item) => [item.id, item]))
    return { signatures: items, signatureMap: map }
  }, [records])

  return { signatures, records, signatureMap, fields, isLoading, error, refresh }
}

/**
 * Hook to get a single signature by ID.
 *
 * @param signatureId - The signature ID to fetch
 * @returns The signature and loading state
 *
 * @example
 * ```tsx
 * const { signature, isLoading } = useSignature(selectedSignatureId)
 * ```
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
 * Hook to get the default signature.
 *
 * @returns The default signature and loading state
 *
 * @example
 * ```tsx
 * const { signature: defaultSignature, isLoading } = useDefaultSignature()
 * ```
 */
export function useDefaultSignature() {
  const { signatures, isLoading } = useSignatures()

  const signature = useMemo(() => {
    return signatures.find((s) => s.isDefault)
  }, [signatures])

  return { signature, isLoading }
}
