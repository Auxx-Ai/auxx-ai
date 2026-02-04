// apps/web/src/components/resources/hooks/use-all-records.ts

import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '~/trpc/react'
import { useRecordStore, type RecordMeta } from '../store/record-store'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type StoredFieldValue,
  type FieldValueKey,
  type CustomFieldValueState,
} from '../store/field-value-store'
import { toRecordId } from '@auxx/lib/resources/client'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import type { FieldId } from '@auxx/types/field'
import type { FieldType } from '@auxx/database/types'

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
 * Field info for client-side operations (key → id mapping)
 */
export interface FieldInfo {
  id: string
  key: string
  type: string
}

/**
 * Result from useAllRecords hook
 */
interface UseAllRecordsResult<T = RecordMeta> {
  /** All records with field values */
  records: T[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string | null
  /** Map of field key to field info (for resolving fieldIds when saving) */
  fields: Record<string, FieldInfo>
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

  // Query all records with field values (for initial load + metadata)
  const { data, isLoading, error, refetch } = api.record.listAll.useQuery(
    { entityDefinitionId, apiSlug, fieldIds, includeArchived },
    {
      enabled: shouldFetch,
      staleTime: 30_000, // 30 seconds
    }
  )

  // Store actions - use proper zustand selectors
  const setRecords = useRecordStore((s) => s.setRecords)
  const setFieldValues = useFieldValueStore((s) => s.setValues)

  const resolvedEntityDefId = data?.entityDefinitionId ?? null

  // Resolve fieldKey → fieldId (UUID) using data.fields from API response
  // System fields use systemAttribute as key (e.g., 'inbox_name') but save uses UUID
  // Custom fields already use UUID as key, so resolution is a no-op for them
  const resolveFieldId = useCallback(
    (fieldKey: string): string => {
      return data?.fields[fieldKey]?.id ?? fieldKey
    },
    [data?.fields]
  )

  // Build field value keys for all records (stable reference)
  const fieldValueKeys = useMemo(() => {
    if (!data?.items || !resolvedEntityDefId) return []
    const keys: FieldValueKey[] = []
    for (const item of data.items) {
      const recordId = toRecordId(resolvedEntityDefId, item.id)
      for (const fieldKey of Object.keys(item.fieldValues)) {
        const resolvedFieldId = resolveFieldId(fieldKey)
        keys.push(buildFieldValueKey(recordId, resolvedFieldId))
      }
    }
    return keys
  }, [data?.items, resolvedEntityDefId, resolveFieldId])

  // Stable string key for selector memoization
  const keysKey = fieldValueKeys.join(',')

  // Subscribe to ONLY the field values we need (prevents re-renders from unrelated changes)
  const relevantFieldValues = useFieldValueStore(
    useShallow(
      useCallback(
        (state: CustomFieldValueState): Record<FieldValueKey, StoredFieldValue | undefined> => {
          const result: Record<FieldValueKey, StoredFieldValue | undefined> = {}
          for (const key of fieldValueKeys) {
            result[key] = state.values[key]
          }
          return result
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keysKey] // Recompute selector when keys change
      )
    )
  )

  // Populate both stores when data arrives
  useEffect(() => {
    if (!data?.items || !data.entityDefinitionId) return

    const entityDefId = data.entityDefinitionId

    // Populate record store (no list cache - records map is the cache)
    // This allows useRecordList to skip fetching these records later
    // since requestRecord checks: records[entityDefId]?.has(id)
    setRecords(entityDefId, data.items)

    // Populate field value store (expects Array<{ key, value }> format)
    // Use resolveFieldId to ensure keys match what save operations use
    const fieldValueEntries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []

    for (const item of data.items) {
      const recordId = toRecordId(entityDefId, item.id)

      for (const [fieldKey, value] of Object.entries(item.fieldValues)) {
        // Resolve systemAttribute → UUID (custom fields already use UUID, so no-op)
        const resolvedFieldId = resolveFieldId(fieldKey)
        const key = buildFieldValueKey(recordId, resolvedFieldId)
        fieldValueEntries.push({ key, value: value as StoredFieldValue })
      }
    }

    if (fieldValueEntries.length > 0) {
      setFieldValues(fieldValueEntries)
    }
  }, [data, setRecords, setFieldValues, resolveFieldId])

  // Compose records from base data + store field values (reactive to optimistic updates)
  const records = useMemo(() => {
    if (!data?.items || !resolvedEntityDefId) return []

    return data.items.map((item) => {
      const recordId = toRecordId(resolvedEntityDefId, item.id)

      // Build field values by reading from store (includes optimistic updates)
      const composedFieldValues: Record<string, unknown> = {}
      for (const fieldKey of Object.keys(item.fieldValues)) {
        const resolvedFieldId = resolveFieldId(fieldKey)
        const storeKey = buildFieldValueKey(recordId, resolvedFieldId)
        // Prefer store value (may have optimistic update), fallback to API data
        const storeValue = relevantFieldValues[storeKey]
        if (storeValue !== undefined) {
          // Unwrap TypedFieldValue to raw value using formatToRawValue
          const fieldType = (data?.fields[fieldKey]?.type ?? 'TEXT') as FieldType
          composedFieldValues[fieldKey] = formatToRawValue(storeValue, fieldType)
        } else {
          composedFieldValues[fieldKey] = item.fieldValues[fieldKey]
        }
      }

      return {
        ...item,
        fieldValues: composedFieldValues,
      }
    })
  }, [data?.items, resolvedEntityDefId, relevantFieldValues, resolveFieldId])

  return {
    records: records as T[],
    entityDefinitionId: resolvedEntityDefId,
    fields: data?.fields ?? {},
    isLoading: shouldFetch && isLoading,
    error: error ?? null,
    refresh: refetch,
  }
}
