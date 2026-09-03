// apps/web/src/components/resources/hooks/use-field-values.ts

import type { CellSyncInfo } from '@auxx/lib/data-connectors/client'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  type FieldId,
  type FieldReference,
  type FieldValueKey,
  fieldRefToKey,
} from '@auxx/types/field'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import {
  type AiCellState,
  type CustomFieldValueState,
  type StoredFieldValue,
  useFieldValueStore,
} from '../store/field-value-store'
import { buildCanonicalFieldValueKey } from '../utils/canonicalize-field-ref'
import { usePrefixEpoch } from '../utils/normalize-record-id'

/**
 * Options for useFieldValue hook.
 */
interface UseFieldValueOptions {
  /** When true, automatically fetch the value if not in store */
  autoFetch?: boolean
}

/**
 * Memoize the canonical field-value key for a (recordId, fieldRef) pair.
 * Both halves are canonicalized (RecordId prefix AND fieldRef definition
 * segments) so subscriber keys always agree with queue/request keys.
 * Recomputes only when inputs or prefix mappings change — no resource-store
 * subscription, so field-metadata updates never fan out here.
 */
function useCanonicalKey(
  rawRecordId: RecordId,
  fieldRef: FieldReference | undefined
): { recordId: RecordId; fieldRef: FieldReference | undefined; key: FieldValueKey | null } {
  const epoch = usePrefixEpoch()
  const refKey = fieldRef ? fieldRefToKey(fieldRef) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: refKey stands in for fieldRef; epoch invalidates store-derived results
  return useMemo(() => {
    if (!fieldRef) return { recordId: rawRecordId, fieldRef, key: null }
    return buildCanonicalFieldValueKey(rawRecordId, fieldRef)
  }, [rawRecordId, refKey, epoch])
}

const EMPTY_VALUE_STATE: { value: StoredFieldValue | undefined; isLoading: boolean } = {
  value: undefined,
  isLoading: false,
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
  rawRecordId: RecordId,
  fieldRef: FieldReference | undefined,
  options: UseFieldValueOptions = {}
): { value: StoredFieldValue | undefined; isLoading: boolean } {
  const { autoFetch = false } = options
  const { recordId, fieldRef: canonicalRef, key } = useCanonicalKey(rawRecordId, fieldRef)

  // Single shallow subscription for value + loading state
  const state = useFieldValueStore(
    useShallow((s: CustomFieldValueState) =>
      key ? { value: s.values[key], isLoading: key in s.fetchingKeys } : EMPTY_VALUE_STATE
    )
  )

  // Track requested keys to prevent duplicate requests
  const requestedRef = useRef<Set<string>>(new Set())

  // Queue fetch in useLayoutEffect - runs synchronously before paint
  // This prevents the flicker where the component renders with isLoading=false
  useLayoutEffect(() => {
    if (!autoFetch || !key || !canonicalRef) return
    if (state.value !== undefined) return
    if (requestedRef.current.has(key)) return

    requestedRef.current.add(key)
    fieldValueFetchQueue.queueFetch(recordId, canonicalRef)
  }, [autoFetch, state.value, key, recordId, canonicalRef])

  // Clear requested set when key changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: key triggers clearing the requested set
  useEffect(() => {
    requestedRef.current.clear()
  }, [key])

  return state
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
 * Returns Record keyed by the INPUT fieldRefKey (use fieldRefToKey for
 * consistent keys) — store lookups use canonical keys internally.
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
  rawRecordId: RecordId,
  fieldRefs: FieldReference[],
  options: UseFieldValuesOptions = {}
): { values: Record<string, StoredFieldValue | undefined>; isLoading: boolean } {
  const { autoFetch = false } = options
  const epoch = usePrefixEpoch()
  const refsKey = fieldRefs.map(fieldRefToKey).join(',')

  // Canonicalize once per (recordId, refs, prefix-map) combination
  // biome-ignore lint/correctness/useExhaustiveDependencies: refsKey stands in for fieldRefs; epoch invalidates store-derived results
  const canonical = useMemo(() => {
    return fieldRefs.map((fieldRef) => {
      const { recordId, fieldRef: ref, key } = buildCanonicalFieldValueKey(rawRecordId, fieldRef)
      return { recordId, fieldRef: ref, key, resultKey: fieldRefToKey(fieldRef) }
    })
  }, [rawRecordId, refsKey, epoch])

  // Subscribe to values
  const values = useFieldValueStore(
    useShallow((state: CustomFieldValueState) => {
      const result: Record<string, StoredFieldValue | undefined> = {}
      for (const entry of canonical) {
        result[entry.resultKey] = state.values[entry.key]
      }
      return result
    })
  )

  // Subscribe to loading state
  const isLoading = useFieldValueStore((state: CustomFieldValueState) => {
    for (const entry of canonical) {
      if (entry.key in state.fetchingKeys) return true
    }
    return false
  })

  // Auto-fetch: queue once per unique (recordId + fieldRefs) combination
  const queuedKeyRef = useRef<string>('')

  useLayoutEffect(() => {
    if (!autoFetch || canonical.length === 0) return

    const requestKey = `${rawRecordId}:${refsKey}:${epoch}`
    if (queuedKeyRef.current === requestKey) return
    queuedKeyRef.current = requestKey

    // Use batch queue - handles deduplication internally
    fieldValueFetchQueue.queueFetchBatch(
      canonical.map((entry) => ({ recordId: entry.recordId, fieldRef: entry.fieldRef }))
    )
  }, [autoFetch, rawRecordId, refsKey, epoch, canonical])

  return { values, isLoading }
}

/** State bundle returned by {@link useFieldCellState}. */
export interface FieldCellState {
  value: StoredFieldValue | undefined
  isLoading: boolean
  aiState: AiCellState | undefined
  /** Contributing data-connector sync state when the cell is bound to a connector. */
  sync: CellSyncInfo | undefined
}

const EMPTY_CELL_STATE: FieldCellState = {
  value: undefined,
  isLoading: false,
  aiState: undefined,
  sync: undefined,
}

/**
 * Combined cell-state selector for high-volume field rendering (table cells).
 * Builds the canonical key ONCE and selects value, loading, AI, and managed
 * state through a single shallow store subscription — instead of the three
 * subscriptions + repeated normalization the individual hooks would add up to.
 */
export function useFieldCellState(
  rawRecordId: RecordId,
  fieldRef: FieldReference | undefined,
  options: UseFieldValueOptions = {}
): FieldCellState {
  const { autoFetch = false } = options
  const { recordId, fieldRef: canonicalRef, key } = useCanonicalKey(rawRecordId, fieldRef)

  const state = useFieldValueStore(
    useShallow((s: CustomFieldValueState): FieldCellState => {
      if (!key) return EMPTY_CELL_STATE
      return {
        value: s.values[key],
        isLoading: key in s.fetchingKeys,
        aiState: s.aiStates[key],
        sync: s.managedStates[key],
      }
    })
  )

  const requestedRef = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    if (!autoFetch || !key || !canonicalRef) return
    if (state.value !== undefined) return
    if (requestedRef.current.has(key)) return

    requestedRef.current.add(key)
    fieldValueFetchQueue.queueFetch(recordId, canonicalRef)
  }, [autoFetch, state.value, key, recordId, canonicalRef])

  return state
}

/**
 * Subscribe to the AI cell state for a given (record, field) pair. Returns
 * `undefined` when the cell has no AI marker (not AI-generated, or AI has
 * never touched it). Hides the `parseRecordId → toResourceFieldId →
 * buildFieldValueKey → useFieldValueStore` chain that every AI overlay
 * mount point would otherwise re-implement.
 */
export function useFieldAiState(rawRecordId: RecordId, fieldId: FieldId): AiCellState | undefined {
  const key = useAttributeKey(rawRecordId, fieldId)
  return useFieldValueStore((s) => (key ? s.aiStates[key] : undefined))
}

/**
 * Subscribe to the contributing data-connector sync state for a (record, field)
 * pair. Returns the connector id, state and overwrite flag when the cell is
 * bound to a contributing connector, else `undefined`. Mirrors `useFieldAiState`:
 * the cell stays editable; this only drives the sync badge and its menu.
 */
export function useFieldManagedState(
  rawRecordId: RecordId,
  fieldId: FieldId
): CellSyncInfo | undefined {
  const key = useAttributeKey(rawRecordId, fieldId)
  return useFieldValueStore((s) => (key ? s.managedStates[key] : undefined))
}

/** Canonical key for a (record, plain-FieldId) pair — shared by the marker hooks. */
function useAttributeKey(rawRecordId: RecordId, fieldId: FieldId): FieldValueKey | null {
  const epoch = usePrefixEpoch()
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates store-derived results
  return useMemo(() => {
    if (!fieldId) return null
    const { key } = buildCanonicalFieldValueKey(rawRecordId, fieldId as unknown as FieldReference)
    return key
  }, [rawRecordId, fieldId, epoch])
}
