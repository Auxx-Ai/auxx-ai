// apps/web/src/components/resources/hooks/use-field-values.ts

import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldRefToKey, type FieldReference } from '@auxx/types/field'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type CustomFieldValueState,
  type StoredFieldValue,
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
 */
export function useFieldValue(
  recordId: RecordId,
  fieldRef: FieldReference | undefined,
  options: UseFieldValueOptions = {}
): { value: StoredFieldValue | undefined; isLoading: boolean } {
  const { autoFetch = false } = options

  // Handle undefined fieldRef - return early with undefined value
  const key = fieldRef ? buildFieldValueKey(recordId, fieldRef) : ('' as any)

  // Stable selector that subscribes to both value and loading state
  const selector = useCallback(
    (state: CustomFieldValueState) => ({
      value: state.values[key],
      isLoading: state.isKeyLoading(key),
    }),
    [key]
  )

  // Use shallow comparison to prevent unnecessary re-renders
  const { value, isLoading } = useFieldValueStore(useShallow(selector))

  // Auto-fetch if enabled and value is missing (skip if fieldRef is undefined)
  useEffect(() => {
    if (autoFetch && fieldRef && value === undefined && !isLoading) {
      // Lazy import to avoid circular dependency
      import('../store/field-value-fetch-queue').then(({ fieldValueFetchQueue }) => {
        fieldValueFetchQueue.queueFetch(recordId, fieldRef)
      })
    }
  }, [autoFetch, value, isLoading, recordId, fieldRef])

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
