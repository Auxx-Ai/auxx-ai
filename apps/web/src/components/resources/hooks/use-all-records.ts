// apps/web/src/components/resources/hooks/use-all-records.ts

import type { FieldType } from '@auxx/database/types'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { type FieldId, toFieldId } from '@auxx/types/field'
import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api, type RouterOutputs } from '~/trpc/react'
import {
  buildFieldValueKey,
  type CustomFieldValueState,
  type FieldValueKey,
  type StoredFieldValue,
  useFieldValueStore,
} from '../store/field-value-store'
import { type RecordMeta, type RecordStoreState, useRecordStore } from '../store/record-store'

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

/** Element shape of `api.record.listAll`'s `data.items` — what `appendRecord` expects. */
export type AllRecordsItem = NonNullable<RouterOutputs['record']['listAll']>['items'][number]

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
  /**
   * Append a freshly created item straight into the `listAll` cache — skips
   * the `refresh()` round-trip so it appears instantly. No-op if the cache
   * hasn't been populated yet (falls back to the next natural fetch).
   */
  appendRecord: (item: AllRecordsItem) => void
  /**
   * Remove a deleted item from the `listAll` cache, the record store, and its
   * field-value store keys — the delete counterpart of `appendRecord`. Skips
   * the `refresh()` round-trip so the row disappears instantly.
   */
  removeRecord: (id: string) => void
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
  const { entityDefinitionId, apiSlug, fieldIds, includeArchived, enabled = true } = options

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

  const utils = api.useUtils()

  // Append a new item directly into the listAll cache (same query input as
  // above) instead of refetching the whole list. The populate-effect below
  // re-runs off this cache write, so the record/field-value stores get
  // seeded for free.
  const appendRecord = useCallback(
    (item: AllRecordsItem) => {
      utils.record.listAll.setData(
        { entityDefinitionId, apiSlug, fieldIds, includeArchived },
        (old) => (old ? { ...old, items: [...old.items, item] } : old)
      )
    },
    [utils, entityDefinitionId, apiSlug, fieldIds, includeArchived]
  )

  const resolvedEntityDefId = data?.entityDefinitionId ?? null

  // Remove a deleted item from the listAll cache directly instead of
  // refetching — the delete counterpart of appendRecord above. Also drops the
  // row from the record store and clears its field-value store keys so a
  // stale row can't reappear via the compose step.
  const removeRecord = useCallback(
    (id: string) => {
      utils.record.listAll.setData(
        { entityDefinitionId, apiSlug, fieldIds, includeArchived },
        (old) => (old ? { ...old, items: old.items.filter((item) => item.id !== id) } : old)
      )
      if (resolvedEntityDefId) {
        useRecordStore.getState().removeRecord(resolvedEntityDefId, id)
        useFieldValueStore.getState().invalidateResource(toRecordId(resolvedEntityDefId, id))
      }
    },
    [utils, entityDefinitionId, apiSlug, fieldIds, includeArchived, resolvedEntityDefId]
  )

  // Resolve fieldKey → fieldId (UUID) using data.fields from API response
  // System fields use systemAttribute as key (e.g., 'inbox_name') but save uses UUID
  // Custom fields already use UUID as key, so resolution is a no-op for them
  const resolveFieldId = useCallback(
    (fieldKey: string): FieldId => {
      return toFieldId(data?.fields[fieldKey]?.id ?? fieldKey)
    },
    [data?.fields]
  )

  // Build field value keys for all records (stable reference). Union the
  // payload's own keys with the entity's known field keys (`data.fields`) —
  // a freshly created record has no payload entry for fields that only got
  // a value via a later store write (createEntity only writes fields it was
  // given or that have a configured defaultValue), so subscribing to payload
  // keys alone means the compose step below never re-runs when that field
  // gets its first store value.
  const fieldValueKeys = useMemo(() => {
    if (!data?.items || !resolvedEntityDefId) return []
    const knownFieldKeys = data.fields ? Object.keys(data.fields) : []
    const keys: FieldValueKey[] = []
    for (const item of data.items) {
      const recordId = toRecordId(resolvedEntityDefId, item.id)
      const unionKeys = new Set([...Object.keys(item.fieldValues), ...knownFieldKeys])
      for (const fieldKey of unionKeys) {
        const resolvedFieldId = resolveFieldId(fieldKey)
        keys.push(buildFieldValueKey(recordId, resolvedFieldId))
      }
    }
    return keys
  }, [data?.items, data?.fields, resolvedEntityDefId, resolveFieldId])

  // Stable string key for selector memoization
  const keysKey = fieldValueKeys.join(',')

  // Stable list of record ids for the current page (for meta overlay below)
  const recordIds = useMemo(() => (data?.items ?? []).map((item) => item.id), [data?.items])
  const idsKey = recordIds.join(',')

  // Subscribe to the per-record meta (displayName / secondaryDisplayValue / avatarUrl)
  // from the record store. Realtime keeps these fresh via use-resource-sync; the
  // listAll React Query payload doesn't. Reading from the store here lets denormalized
  // columns flow through to consumers the same way fieldValues already do.
  const storeMetas = useRecordStore(
    useShallow(
      // biome-ignore lint/correctness/useExhaustiveDependencies: recordIds is captured from the same render as idsKey; idsKey serves as the stable content key
      useCallback(
        (state: RecordStoreState): Record<string, RecordMeta | undefined> => {
          if (!resolvedEntityDefId) return {}
          const bucket = state.records[resolvedEntityDefId]
          if (!bucket) return {}
          const result: Record<string, RecordMeta | undefined> = {}
          for (const id of recordIds) result[id] = bucket.get(id)
          return result
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [resolvedEntityDefId, idsKey]
      )
    )
  )

  // Subscribe to ONLY the field values we need (prevents re-renders from unrelated changes)
  const relevantFieldValues = useFieldValueStore(
    useShallow(
      // biome-ignore lint/correctness/useExhaustiveDependencies: fieldValueKeys is derived from keysKey, using keysKey as stable string dependency
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

  // Populate both stores when data arrives. The field-value store is
  // authoritative once a key exists — this effect only fills GAPS (first
  // load, a newly appended record) rather than re-seeding every key on every
  // `data` identity change, which would stomp a since-confirmed optimistic
  // edit that this stale payload doesn't know about yet. `refresh()` below is
  // the explicit reconcile path that clears keys before refetching.
  useEffect(() => {
    if (!data?.items || !data.entityDefinitionId) return

    const entityDefId = data.entityDefinitionId

    // Populate record store (no list cache - records map is the cache)
    // This allows useRecordList to skip fetching these records later
    // since requestRecord checks: records[entityDefId]?.has(id)
    setRecords(entityDefId, data.items)

    // Populate field value store (expects Array<{ key, value }> format).
    // Use resolveFieldId to ensure keys match what save operations use, and
    // skip any key the store already has a value for (store wins).
    const currentValues = useFieldValueStore.getState().values
    const fieldValueEntries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []

    for (const item of data.items) {
      const recordId = toRecordId(entityDefId, item.id)

      for (const [fieldKey, value] of Object.entries(item.fieldValues)) {
        // Resolve systemAttribute → UUID (custom fields already use UUID, so no-op)
        const resolvedFieldId = resolveFieldId(fieldKey)
        const key = buildFieldValueKey(recordId, resolvedFieldId)
        if (key in currentValues) continue
        fieldValueEntries.push({ key, value: value as StoredFieldValue })
      }
    }

    if (fieldValueEntries.length > 0) {
      setFieldValues(fieldValueEntries)
    }
  }, [data, setRecords, setFieldValues, resolveFieldId])

  // Explicit reconcile path: invalidate the field-value store for the
  // currently-listed records BEFORE refetching, so the populate effect above
  // (which only fills gaps) re-seeds those keys fresh once the new `data`
  // lands. Realtime keeps mounted rows fresh in between; this is for callers
  // that need a hard resync (e.g. after a raw `record.update` that bypasses
  // the field-value store).
  const refresh = useCallback(() => {
    if (resolvedEntityDefId && data?.items) {
      const currentRecordIds = data.items.map((item) => toRecordId(resolvedEntityDefId, item.id))
      useFieldValueStore.getState().invalidateResources(currentRecordIds)
    }
    return refetch()
  }, [resolvedEntityDefId, data?.items, refetch])

  // Compose records from base data + store field values (reactive to optimistic updates)
  const records = useMemo(() => {
    if (!data?.items || !resolvedEntityDefId) return []

    const knownFieldKeys = data.fields ? Object.keys(data.fields) : []

    return data.items.map((item) => {
      const recordId = toRecordId(resolvedEntityDefId, item.id)
      const storeMeta = storeMetas[item.id]

      // Build field values from the union of the payload's keys and the
      // entity's known field keys — a fresh record has no payload entry for
      // a field it only got a value for via a later store write (see
      // fieldValueKeys above for why). Keys absent from both store and
      // payload compose to `undefined`; consumers already `?? null` those.
      const composedFieldValues: Record<string, unknown> = {}
      const unionKeys = new Set([...Object.keys(item.fieldValues), ...knownFieldKeys])
      for (const fieldKey of unionKeys) {
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

      // Overlay denormalized columns from the record store. Realtime keeps these
      // fresh after every record:updated event; falls back to the listAll payload
      // on the first render before the store is populated.
      return {
        ...item,
        displayName: (storeMeta?.displayName as string | undefined) ?? item.displayName,
        secondaryDisplayValue:
          (storeMeta?.secondaryDisplayValue as string | undefined) ?? item.secondaryDisplayValue,
        avatarUrl: (storeMeta?.avatarUrl as string | undefined) ?? item.avatarUrl,
        fieldValues: composedFieldValues,
      }
    })
  }, [
    data?.items,
    data?.fields,
    resolvedEntityDefId,
    relevantFieldValues,
    resolveFieldId,
    storeMetas,
  ])

  return {
    // `T` is the caller's assertion about which columns this entity carries.
    // The composed rows are `RecordMeta`; the extra columns ride the index
    // signature, so the narrowing can only be checked by the caller.
    records: records as RecordMeta[] as T[],
    entityDefinitionId: resolvedEntityDefId,
    fields: data?.fields ?? {},
    isLoading: shouldFetch && isLoading,
    // react-query types the error as `TRPCClientErrorLike`, a structural alias
    // that drops the `Error` members; the runtime value is always a
    // `TRPCClientError`, which extends `Error`.
    error: (error as Error | null) ?? null,
    refresh,
    appendRecord,
    removeRecord,
  }
}
