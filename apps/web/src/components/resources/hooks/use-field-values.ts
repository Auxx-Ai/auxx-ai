// apps/web/src/components/resources/hooks/use-field-values.ts

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldRefToKey, type FieldReference } from '@auxx/types/field'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type CustomFieldValueState,
  type StoredFieldValue,
} from '../store/field-value-store'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'

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
  useEffect(() => {
    requestedRef.current.clear()
  }, [key])

  return { value, isLoading }
}

/**
 * Get multiple values for a single resource by FieldReferences.
 * Uses stable selector with useShallow for memoization to prevent infinite loops.
 * Returns Record keyed by fieldRefKey (use fieldRefToKey for consistent keys).
 */
export function useResourceFieldValues(
  recordId: RecordId,
  fieldRefs: FieldReference[]
): Record<string, StoredFieldValue | undefined> {
  // Use fieldRefToKey for stable string keys
  const refsKey = fieldRefs.map(fieldRefToKey).join(',')

  // Create stable selector that only changes when inputs change
  const selector = useCallback(
    (state: CustomFieldValueState) => {
      const result: Record<string, StoredFieldValue | undefined> = {}
      for (const fieldRef of fieldRefs) {
        const key = buildFieldValueKey(recordId, fieldRef)
        const refKey = fieldRefToKey(fieldRef)
        result[refKey] = state.values[key]
      }
      return result
    },
    [refsKey, recordId]
  )

  // Wrap stable selector with useShallow for shallow comparison
  const memoizedSelector = useShallow(selector)

  return useFieldValueStore(memoizedSelector)
}
