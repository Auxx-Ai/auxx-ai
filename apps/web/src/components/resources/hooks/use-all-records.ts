// apps/web/src/components/resources/hooks/use-all-records.ts

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type StoredFieldValue,
  type FieldValueKey,
} from '../store/field-value-store'
import { toRecordId } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'

/**
 * Options for useAllRecords hook
 */
interface UseAllRecordsOptions {
  /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
  entityDefinitionId?: string
  /** API slug like 'tags', 'contacts' */
  apiSlug?: string
  /** Specific field IDs to fetch */
  fieldIds?: FieldId[]
  /** Include archived records */
  includeArchived?: boolean
  /** Disable fetching */
  enabled?: boolean
}

/**
 * Result from useAllRecords hook
 */
interface UseAllRecordsResult<T = RecordMeta> {
  /** All records with field values */
  records: T[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string | null
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refetch data */
  refresh: () => void
}

/**
 * Hook to fetch all records of an entity type with field values.
 * Suitable for small datasets like Tags, Inboxes, etc.
 *
 * Populates both record store and field value store for reactive updates.
 *
 * Store population notes:
 * - Records are added to `records[entityDefinitionId]` map
 * - Field values are added to field value store with proper keys
 * - No list cache entry is created (lists are for paginated/filtered views)
 * - If useRecordList is used later, it will skip fetching records that already exist
 * - Loading state comes from React Query's isLoading (not store's pendingFetchIds)
 *
 * @example
 * ```tsx
 * // Fetch all tags
 * const { records: tags, isLoading } = useAllRecords({
 *   entityDefinitionId: 'tag',
 * })
 *
 * // Fetch by apiSlug
 * const { records: inboxes } = useAllRecords({
 *   apiSlug: 'inboxes',
 * })
 *
 * // Fetch custom entity by UUID
 * const { records } = useAllRecords({
 *   entityDefinitionId: 'clx1abc...',
 * })
 * ```
 */
export function useAllRecords<T extends RecordMeta = RecordMeta>(
  options: UseAllRecordsOptions
): UseAllRecordsResult<T> {
  const {
    entityDefinitionId,
    apiSlug,
    fieldIds,
    includeArchived,
    enabled = true,
  } = options

  const shouldFetch = enabled && !!(entityDefinitionId || apiSlug)

  // Query all records with field values
  const {
    data,
    isLoading,
    error,
    refetch,
  } = api.record.listAll.useQuery(
    { entityDefinitionId, apiSlug, fieldIds, includeArchived },
    {
      enabled: shouldFetch,
      staleTime: 30_000, // 30 seconds
    }
  )

  // Store actions - use proper zustand selectors
  const setRecords = useRecordStore((s) => s.setRecords)
  const setFieldValues = useFieldValueStore((s) => s.setValues)

  // Populate both stores when data arrives
  useEffect(() => {
    if (!data?.items || !data.entityDefinitionId) return

    const resolvedEntityDefId = data.entityDefinitionId

    // Populate record store (no list cache - records map is the cache)
    // This allows useRecordList to skip fetching these records later
    // since requestRecord checks: records[entityDefId]?.has(id)
    setRecords(resolvedEntityDefId, data.items)

    // Populate field value store (expects Array<{ key, value }> format)
    const fieldValueEntries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []

    for (const item of data.items) {
      const recordId = toRecordId(resolvedEntityDefId, item.id)

      for (const [fieldRef, value] of Object.entries(item.fieldValues)) {
        const key = buildFieldValueKey(recordId, fieldRef)
        fieldValueEntries.push({ key, value: value as StoredFieldValue })
      }
    }

    if (fieldValueEntries.length > 0) {
      setFieldValues(fieldValueEntries)
    }
  }, [data, setRecords, setFieldValues])

  return {
    records: (data?.items ?? []) as T[],
    entityDefinitionId: data?.entityDefinitionId ?? null,
    isLoading: shouldFetch && isLoading,
    error: error ?? null,
    refresh: refetch,
  }
}
