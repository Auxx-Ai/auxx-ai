// apps/web/src/components/resources/hooks/use-field-values.ts

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import {
  type FieldId,
  type FieldReference,
  fieldRefToKey,
  toResourceFieldId,
} from '@auxx/types/field'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import {
  type AiCellState,
  buildFieldValueKey,
  type CustomFieldValueState,
  type StoredFieldValue,
  useFieldValueStore,
} from '../store/field-value-store'

/**
 * Options for useFieldValue hook.
 */
interface UseFieldValueOptions {
  /** When true, automatically fetch the value if not in store */
  autoFetch?: boolean
}

/**
 * Subscribe to a field value and its loading state.
 * Works uniformly for both regular fields and CALC fields.
 * Component only re-renders when this specific value or loading state changes.
 *
 * @example
 * // Direct field (passive - no auto-fetch)
 * const { value, isLoading } = useFieldValue(recordId, 'contact:email')
 *
 * @example
 * // Direct field with auto-fetch (for single-record views)
 * const { value, isLoading } = useFieldValue(recordId, 'contact:email', { autoFetch: true })
 *
 * @example
 * // Field path (relationship traversal)
 * const { value, isLoading } = useFieldValue(recordId, ['product:vendor', 'vendor:name'])
 *
 * @example
 * // CALC field (computed automatically from source fields)
 * const { value, isLoading } = useFieldValue(recordId, 'order:totalPrice', { autoFetch: true })
 */
export function useFieldValue(
  recordId: RecordId,
  fieldRef: FieldReference | undefined,
  options: UseFieldValueOptions = {}
): { value: StoredFieldValue | undefined; isLoading: boolean } {
  const { autoFetch = false } = options
  const key = fieldRef ? buildFieldValueKey(recordId, fieldRef) : ('' as any)

  // Subscribe to value
  const value = useFieldValueStore(
    useCallback(
      (state: CustomFieldValueState) => (fieldRef ? state.values[key] : undefined),
      [key, fieldRef]
    )
  )

  // Subscribe to loading state
  const isLoading = useFieldValueStore(
    useCallback(
      (state: CustomFieldValueState) => (fieldRef ? key in state.fetchingKeys : false),
      [key, fieldRef]
    )
  )

  // Track requested keys to prevent duplicate requests
  const requestedRef = useRef<Set<string>>(new Set())

  // Queue fetch in useLayoutEffect - runs synchronously before paint
  // This prevents the flicker where the component renders with isLoading=false
  useLayoutEffect(() => {
    if (!autoFetch || !fieldRef) return
    if (value !== undefined) return
    if (requestedRef.current.has(key)) return

    requestedRef.current.add(key)
    fieldValueFetchQueue.queueFetch(recordId, fieldRef)
  }, [autoFetch, fieldRef, value, key, recordId])

  // Clear requested set when key changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: key triggers clearing the requested set
  useEffect(() => {
    requestedRef.current.clear()
  }, [key])

  return { value, isLoading }
}

/**
 * Options for useFieldValues hook.
 */
interface UseFieldValuesOptions {
  /** When true, automatically fetch missing values via fieldValueFetchQueue */
  autoFetch?: boolean
}

/**
 * Get multiple values for a single resource by FieldReferences.
 * Uses stable selector with useShallow for memoization to prevent infinite loops.
 * Returns Record keyed by fieldRefKey (use fieldRefToKey for consistent keys).
 *
 * @example
 * // Passive subscription (no auto-fetch)
 * const { values, isLoading } = useFieldValues(recordId, fieldRefs)
 *
 * @example
 * // With auto-fetch for single-record views
 * const { values, isLoading } = useFieldValues(recordId, fieldRefs, { autoFetch: true })
 */
export function useFieldValues(
  recordId: RecordId,
  fieldRefs: FieldReference[],
  options: UseFieldValuesOptions = {}
): { values: Record<string, StoredFieldValue | undefined>; isLoading: boolean } {
  const { autoFetch = false } = options
  const refsKey = fieldRefs.map(fieldRefToKey).join(',')

  // Subscribe to values
  const values = useFieldValueStore(
    useShallow(
      // biome-ignore lint/correctness/useExhaustiveDependencies: fieldRefs is derived from refsKey, using refsKey as stable string dependency
      useCallback(
        (state: CustomFieldValueState) => {
          const result: Record<string, StoredFieldValue | undefined> = {}
          for (const fieldRef of fieldRefs) {
            const storeKey = buildFieldValueKey(recordId, fieldRef)
            result[fieldRefToKey(fieldRef)] = state.values[storeKey]
          }
          return result
        },
        [recordId, refsKey]
      )
    )
  )

  // Subscribe to loading state
  const isLoading = useFieldValueStore(
    useCallback(
      (state: CustomFieldValueState) => {
        for (const fieldRef of fieldRefs) {
          if (state.isKeyFetching(buildFieldValueKey(recordId, fieldRef))) return true
        }
        return false
      },
      [recordId, fieldRefs]
    )
  )

  // Auto-fetch: queue once per unique (recordId + fieldRefs) combination
  const queuedKeyRef = useRef<string>('')

  useLayoutEffect(() => {
    if (!autoFetch || fieldRefs.length === 0) return

    const requestKey = `${recordId}:${refsKey}`
    if (queuedKeyRef.current === requestKey) return
    queuedKeyRef.current = requestKey

    // Use batch queue - handles deduplication internally
    fieldValueFetchQueue.queueFetchBatch(fieldRefs.map((fieldRef) => ({ recordId, fieldRef })))
  }, [autoFetch, recordId, refsKey, fieldRefs])

  return { values, isLoading }
}

/**
 * Subscribe to the AI cell state for a given (record, field) pair. Returns
 * `undefined` when the cell has no AI marker (not AI-generated, or AI has
 * never touched it). Hides the `parseRecordId → toResourceFieldId →
 * buildFieldValueKey → useFieldValueStore` chain that every AI overlay
 * mount point would otherwise re-implement.
 */
export function useFieldAiState(recordId: RecordId, fieldId: FieldId): AiCellState | undefined {
  const { entityDefinitionId } = parseRecordId(recordId)
  const resourceFieldId = toResourceFieldId(entityDefinitionId, fieldId)
  const key = buildFieldValueKey(recordId, resourceFieldId)
  return useFieldValueStore((s) => s.aiStates[key])
}
