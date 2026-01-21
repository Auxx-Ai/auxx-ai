// apps/web/src/components/resources/hooks/use-field-values.ts

import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldRefToKey, type FieldReference, type ResourceFieldId, isResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  useFieldValueStore,
  buildFieldValueKey,
  type CustomFieldValueState,
  type StoredFieldValue,
} from '../store/field-value-store'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import { computedFieldRegistry } from '../store/computed-field-registry'
import { getFieldValueWithComputed } from '../store/computed-value-middleware'

/**
 * Options for useFieldValue hook.
 */
interface UseFieldValueOptions {
  /** When true, automatically fetch the value if not in store */
  autoFetch?: boolean
}

/**
 * Subscribe to a field value and its loading state.
 * Supports computed (CALC) fields - automatically computes values from source fields.
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

  // Handle undefined fieldRef - return early with undefined value
  const key = fieldRef ? buildFieldValueKey(recordId, fieldRef) : ('' as any)

  // Check if this is a computed field (only for direct ResourceFieldId references)
  const isComputed = useMemo(() => {
    if (!fieldRef || typeof fieldRef !== 'string') return false
    if (!isResourceFieldId(fieldRef)) return false
    return computedFieldRegistry.isComputed(fieldRef as ResourceFieldId)
  }, [fieldRef])

  // Stable selector - avoid creating new objects in the selector
  // For computed fields, we handle them separately below
  const selector = useCallback(
    (state: CustomFieldValueState) => {
      if (!fieldRef) {
        return { value: undefined, isLoading: false }
      }
      return {
        value: state.values[key],
        isLoading: state.isKeyLoading(key),
      }
    },
    [key, fieldRef]
  )

  // Use shallow comparison to prevent unnecessary re-renders
  const { value: storeValue, isLoading: storeLoading } = useFieldValueStore(useShallow(selector))

  // Handle computed fields OUTSIDE the selector to avoid infinite loops
  const { value, isLoading } = useMemo(() => {
    if (!fieldRef) {
      return { value: undefined, isLoading: false }
    }

    // For computed fields, compute value from source fields
    if (isComputed && typeof fieldRef === 'string') {
      const values = useFieldValueStore.getState().values
      const computedValue = getFieldValueWithComputed(recordId, fieldRef as ResourceFieldId, values)

      // Check if source values are still loading
      const config = computedFieldRegistry.getConfig(fieldRef as ResourceFieldId)
      let sourceLoading = false
      if (config) {
        for (const sourceFieldId of Object.values(config.sourceFields)) {
          const sourceKey = buildFieldValueKey(recordId, sourceFieldId)
          if (useFieldValueStore.getState().isKeyLoading(sourceKey)) {
            sourceLoading = true
            break
          }
        }
      }

      return {
        value: computedValue,
        isLoading: computedValue === undefined || sourceLoading,
      }
    }

    // Regular field
    return { value: storeValue, isLoading: storeLoading }
  }, [fieldRef, isComputed, recordId, storeValue, storeLoading])

  // Auto-fetch source fields for computed fields
  useEffect(() => {
    if (!autoFetch || !isComputed || !fieldRef) return

    const config = computedFieldRegistry.getConfig(fieldRef as ResourceFieldId)
    if (!config) return

    // Queue fetch for each source field
    for (const sourceFieldId of Object.values(config.sourceFields)) {
      fieldValueFetchQueue.queueFetch(recordId, sourceFieldId)
    }
  }, [autoFetch, isComputed, recordId, fieldRef])

  // Standard auto-fetch for non-computed fields
  useEffect(() => {
    if (autoFetch && !isComputed && fieldRef && value === undefined && !isLoading) {
      fieldValueFetchQueue.queueFetch(recordId, fieldRef)
    }
  }, [autoFetch, isComputed, value, isLoading, recordId, fieldRef])

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
