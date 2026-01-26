// apps/web/src/stores/custom-field-value-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { toRecordId, parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  type FieldPath,
  type ResourceFieldId,
  fieldRefToKey,
  keyToFieldRef,
  isFieldPath,
  isResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { computeDependentCalcValues } from './calc-value-computer'

/**
 * Composite key for field values.
 * Format: `${recordId}:${fieldRefKey}` where:
 * - recordId = `${entityDefinitionId}:${entityInstanceId}`
 * - fieldRefKey = fieldRefToKey(fieldRef) (either ResourceFieldId or path with :: separator)
 *
 * Examples:
 * - Direct: "contact:abc123:contact:email" (recordId + ResourceFieldId)
 * - Path: "product:xyz789:product:vendor::vendor:name" (recordId + path)
 */
export type FieldValueKey = `${RecordId}:${string}`

/**
 * Stored value type - can be:
 * - TypedFieldValue (single value with type discriminator)
 * - TypedFieldValue[] (multi-value like multi-select, tags)
 * - Raw value (string, number, boolean, object) during optimistic updates
 * - null (empty value)
 */
export type StoredFieldValue = TypedFieldValue | TypedFieldValue[] | unknown

/** Loading state for a fetch batch */
interface LoadingBatch {
  keys: Set<string>
  timestamp: number
}

/** Pending optimistic update state */
interface PendingUpdate {
  value: StoredFieldValue
  original: StoredFieldValue
}

interface CustomFieldValueState {
  /** Cached values by composite key (use Record for Zustand reactivity) */
  values: Record<FieldValueKey, StoredFieldValue>

  /** Keys currently being fetched (for dedup) - keyed by batch ID */
  loadingBatches: Record<string, LoadingBatch>

  /** Timestamp of last update per key (for staleness checks) */
  updatedAt: Record<FieldValueKey, number>

  /** Pending optimistic updates (key → {newValue, originalValue}) */
  pendingUpdates: Record<FieldValueKey, PendingUpdate>

  /** Mutation version per key - incremented on each mutation initiation for race condition handling */
  mutationVersions: Record<FieldValueKey, number>

  /** Keys currently being fetched (queued or in-flight) - for immediate loading state */
  fetchingKeys: Record<FieldValueKey, true>

  // ─────────────────────────────────────────────────────────────────
  // SETTERS
  // ─────────────────────────────────────────────────────────────────

  /** Set multiple values (batch update from API) */
  setValues: (entries: Array<{ key: FieldValueKey; value: StoredFieldValue }>) => void

  /** Set a single value (optimistic update on save) */
  setValue: (key: FieldValueKey, value: StoredFieldValue) => void

  /** Set value optimistically (stores original for rollback) */
  setValueOptimistic: (key: FieldValueKey, newValue: StoredFieldValue) => void

  /** Confirm optimistic update succeeded */
  confirmOptimistic: (key: FieldValueKey) => void

  /** Rollback optimistic update on error */
  rollbackOptimistic: (key: FieldValueKey) => void

  /** Mark a batch of keys as loading */
  startLoading: (batchId: string, keys: FieldValueKey[]) => void

  /** Clear loading state for a batch */
  finishLoading: (batchId: string) => void

  /** Mark keys as being fetched (called when queued, cleared when values arrive) */
  markFetching: (keys: FieldValueKey[]) => void

  // ─────────────────────────────────────────────────────────────────
  // INVALIDATION (crucial for correctness)
  // ─────────────────────────────────────────────────────────────────

  /** Invalidate a single resource (after updating a contact/ticket/entity) */
  invalidateResource: (recordId: RecordId) => void

  /** Invalidate a specific field reference across all resources (after field definition change) */
  invalidateField: (fieldRef: FieldReference) => void

  /** Invalidate multiple resources (after bulk update) */
  invalidateResources: (recordIds: RecordId[]) => void

  /** Invalidate all values for an entity definition (nuclear option) */
  invalidateByDefinition: (entityDefinitionId: string) => void

  /** Clear everything (on logout, org switch, etc.) */
  clearAll: () => void

  // ─────────────────────────────────────────────────────────────────
  // GETTERS (for imperative access)
  // ─────────────────────────────────────────────────────────────────

  /** Check if a key is currently being fetched (legacy - checks loadingBatches) */
  isKeyLoading: (key: FieldValueKey) => boolean

  /** Check if a key is being fetched (checks fetchingKeys - use this for loading state) */
  isKeyFetching: (key: FieldValueKey) => boolean

  /** Check if a value exists in cache */
  hasValue: (key: FieldValueKey) => boolean

  // ─────────────────────────────────────────────────────────────────
  // MUTATION VERSION TRACKING (for race condition handling)
  // ─────────────────────────────────────────────────────────────────

  /** Increment mutation version for a key, returns the new version */
  incrementMutationVersion: (key: FieldValueKey) => number

  /** Get current mutation version for a key (returns 0 if not set) */
  getMutationVersion: (key: FieldValueKey) => number
}

// ─────────────────────────────────────────────────────────────────
// KEY HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Normalize a FieldReference to ResourceFieldId or FieldPath.
 *
 * If `ref` is a plain FieldId, resolves to ResourceFieldId using entityDefinitionId from recordId.
 * If already ResourceFieldId or FieldPath, returns as-is.
 *
 * @example
 * normalizeFieldRef('contact:abc123', 'email')
 * // => 'contact:email' (ResourceFieldId)
 *
 * @example
 * normalizeFieldRef('contact:abc123', 'contact:email')
 * // => 'contact:email' (already ResourceFieldId, unchanged)
 *
 * @example
 * normalizeFieldRef('product:xyz', ['product:vendor', 'vendor:name'])
 * // => ['product:vendor', 'vendor:name'] (FieldPath, unchanged)
 */
export function normalizeFieldRef(
  recordId: RecordId,
  fieldRef: FieldReference
): ResourceFieldId | FieldPath {
  // FieldPath - return as-is
  if (isFieldPath(fieldRef)) {
    return fieldRef
  }

  // ResourceFieldId - return as-is (has colon)
  if (isResourceFieldId(fieldRef)) {
    return fieldRef
  }

  // Plain FieldId - resolve to ResourceFieldId
  const { entityDefinitionId } = parseRecordId(recordId)
  return toResourceFieldId(entityDefinitionId, fieldRef)
}

/**
 * Build a field value key from RecordId and FieldReference.
 *
 * Automatically normalizes FieldId to ResourceFieldId using the recordId context.
 * This ensures consistent cache keys regardless of whether caller passes
 * FieldId or ResourceFieldId.
 *
 * @example
 * // Plain FieldId - auto-resolved
 * buildFieldValueKey('contact:abc123', 'email')
 * // => 'contact:abc123:contact:email'
 *
 * @example
 * // ResourceFieldId - used directly
 * buildFieldValueKey('contact:abc123', 'contact:email')
 * // => 'contact:abc123:contact:email'
 *
 * @example
 * // FieldPath - used directly
 * buildFieldValueKey('product:xyz789', ['product:vendor', 'vendor:name'])
 * // => 'product:xyz789:product:vendor::vendor:name'
 */
export function buildFieldValueKey(recordId: RecordId, fieldRef: FieldReference): FieldValueKey {
  // Normalize FieldId → ResourceFieldId using recordId context
  const normalizedRef = normalizeFieldRef(recordId, fieldRef)
  const refKey = fieldRefToKey(normalizedRef)
  return `${recordId}:${refKey}` as FieldValueKey
}

/**
 * Parse a field value key back to RecordId and FieldReference.
 * Use parseRecordId() on the returned recordId if you need entityDefinitionId/entityInstanceId.
 */
export function parseFieldValueKey(key: FieldValueKey): {
  recordId: RecordId
  fieldRef: FieldReference
  entityDefinitionId: string
  entityInstanceId: string
} {
  // Format: entityDefId:entityInstId:fieldRefKey
  // fieldRefKey can be:
  // - ResourceFieldId (e.g., "contact:email") - contains single colon
  // - FieldPath (e.g., "product:vendor::vendor:name") - contains ::
  const firstColon = key.indexOf(':')
  const secondColon = key.indexOf(':', firstColon + 1)

  if (firstColon === -1 || secondColon === -1) {
    console.error('[parseFieldValueKey] Malformed key:', key)
    return {
      recordId: key as unknown as RecordId,
      fieldRef: key as ResourceFieldId,
      entityDefinitionId: '',
      entityInstanceId: '',
    }
  }

  const entityDefinitionId = key.slice(0, firstColon)
  const entityInstanceId = key.slice(firstColon + 1, secondColon)
  const fieldRefKey = key.slice(secondColon + 1)

  const recordId = toRecordId(entityDefinitionId, entityInstanceId)
  const fieldRef = keyToFieldRef(fieldRefKey)

  return { recordId, fieldRef, entityDefinitionId, entityInstanceId }
}

/**
 * Check if a key matches a resource (any field on that resource).
 */
export function fieldValueKeyMatchesResource(key: FieldValueKey, recordId: RecordId): boolean {
  return key.startsWith(`${recordId}:`)
}

/**
 * Check if a key matches a specific field reference (on any resource).
 */
export function fieldValueKeyMatchesField(key: FieldValueKey, fieldRef: FieldReference): boolean {
  const refKey = fieldRefToKey(fieldRef)
  return key.endsWith(`:${refKey}`)
}

// ─────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────

export const useFieldValueStore = create<CustomFieldValueState>()(
  subscribeWithSelector((set, get) => ({
    values: {},
    loadingBatches: {},
    updatedAt: {},
    pendingUpdates: {},
    mutationVersions: {},
    fetchingKeys: {},

    // ─── SETTERS ────────────────────────────────────────────────────

    setValues: (entries) => {
      const now = Date.now()
      const keys = entries.map((e) => e.key)

      set((state) => {
        // First, apply the new values
        let newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        // Clear fetchingKeys for values that have arrived
        const newFetchingKeys = { ...state.fetchingKeys }
        for (const key of keys) {
          delete newFetchingKeys[key]
        }

        for (const { key, value } of entries) {
          newValues[key] = value
          newUpdatedAt[key] = now
        }

        // Then compute dependent CALC values
        const calcValues = computeDependentCalcValues(keys, newValues)
        for (const [calcKey, calcValue] of Object.entries(calcValues)) {
          newValues[calcKey as FieldValueKey] = calcValue
          newUpdatedAt[calcKey as FieldValueKey] = now
        }

        return { values: newValues, updatedAt: newUpdatedAt, fetchingKeys: newFetchingKeys }
      })
    },

    setValue: (key, value) => {
      set((state) => {
        const now = Date.now()
        let newValues = { ...state.values, [key]: value }
        const newUpdatedAt = { ...state.updatedAt, [key]: now }

        // Compute dependent CALC values
        const calcValues = computeDependentCalcValues([key], newValues)
        for (const [calcKey, calcValue] of Object.entries(calcValues)) {
          newValues[calcKey as FieldValueKey] = calcValue
          newUpdatedAt[calcKey as FieldValueKey] = now
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    setValueOptimistic: (key, newValue) => {
      set((state) => {
        const now = Date.now()
        const original = state.values[key]
        let newValues = { ...state.values, [key]: newValue }
        const newUpdatedAt = { ...state.updatedAt, [key]: now }

        // Compute dependent CALC values
        const calcValues = computeDependentCalcValues([key], newValues)
        for (const [calcKey, calcValue] of Object.entries(calcValues)) {
          newValues[calcKey as FieldValueKey] = calcValue
          newUpdatedAt[calcKey as FieldValueKey] = now
        }

        return {
          values: newValues,
          pendingUpdates: {
            ...state.pendingUpdates,
            [key]: { value: newValue, original },
          },
          updatedAt: newUpdatedAt,
        }
      })
    },

    confirmOptimistic: (key) => {
      set((state) => {
        const { [key]: _, ...rest } = state.pendingUpdates
        return { pendingUpdates: rest }
      })
    },

    rollbackOptimistic: (key) => {
      set((state) => {
        const pending = state.pendingUpdates[key]
        if (!pending) return state

        const { [key]: _, ...restPending } = state.pendingUpdates
        return {
          values: { ...state.values, [key]: pending.original },
          pendingUpdates: restPending,
          updatedAt: { ...state.updatedAt, [key]: Date.now() },
        }
      })
    },

    startLoading: (batchId, keys) => {
      set((state) => ({
        loadingBatches: {
          ...state.loadingBatches,
          [batchId]: { keys: new Set(keys), timestamp: Date.now() },
        },
      }))
    },

    finishLoading: (batchId) => {
      set((state) => {
        const { [batchId]: _, ...rest } = state.loadingBatches
        return { loadingBatches: rest }
      })
    },

    markFetching: (keys) => {
      set((state) => {
        const newFetchingKeys = { ...state.fetchingKeys }
        for (const key of keys) {
          newFetchingKeys[key] = true
        }
        return { fetchingKeys: newFetchingKeys }
      })
    },

    // ─── INVALIDATION ───────────────────────────────────────────────

    invalidateResource: (recordId) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (fieldValueKeyMatchesResource(key as FieldValueKey, recordId)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateField: (fieldRef) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (fieldValueKeyMatchesField(key as FieldValueKey, fieldRef)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateResources: (recordIds) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }
        const recordIdSet = new Set(recordIds)

        for (const key of Object.keys(newValues)) {
          const { recordId } = parseFieldValueKey(key as FieldValueKey)
          if (recordIdSet.has(recordId)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateByDefinition: (entityDefinitionId) => {
      set((state) => {
        const prefix = `${entityDefinitionId}:`
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (key.startsWith(prefix)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    clearAll: () => {
      set({
        values: {},
        loadingBatches: {},
        updatedAt: {},
        pendingUpdates: {},
        mutationVersions: {},
        fetchingKeys: {},
      })
    },

    // ─── GETTERS ────────────────────────────────────────────────────

    isKeyLoading: (key) => {
      const { loadingBatches } = get()
      for (const batch of Object.values(loadingBatches)) {
        if (batch.keys.has(key)) return true
      }
      return false
    },

    isKeyFetching: (key) => key in get().fetchingKeys,

    hasValue: (key) => {
      return key in get().values
    },

    // ─── MUTATION VERSION TRACKING ──────────────────────────────────

    incrementMutationVersion: (key) => {
      const current = get().mutationVersions[key] ?? 0
      const next = current + 1
      set((state) => ({
        mutationVersions: { ...state.mutationVersions, [key]: next },
      }))
      return next
    },

    getMutationVersion: (key) => {
      return get().mutationVersions[key] ?? 0
    },
  }))
)

// ─────────────────────────────────────────────────────────────────
// TYPE EXPORT (for internal use by hooks)
// ─────────────────────────────────────────────────────────────────
export type { CustomFieldValueState }

// ─────────────────────────────────────────────────────────────────
// RE-EXPORTS for convenience
// ─────────────────────────────────────────────────────────────────
export { toRecordId, parseRecordId, type RecordId } from '@auxx/lib/resources/client'
export {
  type FieldReference,
  type FieldPath,
  type ResourceFieldId,
  fieldRefToKey,
  keyToFieldRef,
  isFieldPath,
} from '@auxx/types/field'
