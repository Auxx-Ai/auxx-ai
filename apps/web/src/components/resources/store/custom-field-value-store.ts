// apps/web/src/stores/custom-field-value-store.ts

import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { toResourceId, parseResourceId, type ResourceId } from '@auxx/lib/resources/client'
import { toFieldId, type FieldId } from '@auxx/types/field'

/**
 * Composite key for field values.
 * Format: `${resourceId}:${fieldId}` where:
 * - resourceId = `${entityDefinitionId}:${entityInstanceId}`
 * - fieldId = field identifier
 *
 * Full format: `${entityDefinitionId}:${entityInstanceId}:${fieldId}`
 */
export type FieldValueKey = `${ResourceId}:${FieldId}`

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

  // ─────────────────────────────────────────────────────────────────
  // INVALIDATION (crucial for correctness)
  // ─────────────────────────────────────────────────────────────────

  /** Invalidate a single resource (after updating a contact/ticket/entity) */
  invalidateResource: (resourceId: ResourceId) => void

  /** Invalidate a specific field across all resources (after field definition change) */
  invalidateField: (fieldId: FieldId | string) => void

  /** Invalidate multiple resources (after bulk update) */
  invalidateResources: (resourceIds: ResourceId[]) => void

  /** Invalidate all values for an entity definition (nuclear option) */
  invalidateByDefinition: (entityDefinitionId: string) => void

  /** Clear everything (on logout, org switch, etc.) */
  clearAll: () => void

  // ─────────────────────────────────────────────────────────────────
  // GETTERS (for imperative access)
  // ─────────────────────────────────────────────────────────────────

  /** Check if a key is currently being fetched */
  isKeyLoading: (key: FieldValueKey) => boolean

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
 * Build a field value key from ResourceId and fieldId.
 * Format: `${entityDefinitionId}:${entityInstanceId}:${fieldId}`
 */
export function buildFieldValueKey(resourceId: ResourceId, fieldId: FieldId | string): FieldValueKey {
  const typedFieldId = typeof fieldId === 'string' ? toFieldId(fieldId) : fieldId
  return `${resourceId}:${typedFieldId}` as FieldValueKey
}

/**
 * Build a field value key from individual components.
 * @deprecated Prefer buildFieldValueKey(resourceId, fieldId) for consistency.
 * Only kept for backward compatibility. Do not use in new code.
 */
export function buildFieldValueKeyFromParts(
  entityDefinitionId: string,
  entityInstanceId: string,
  fieldId: string
): FieldValueKey {
  return `${entityDefinitionId}:${entityInstanceId}:${fieldId}` as FieldValueKey
}

/**
 * Parse a field value key back to ResourceId and fieldId.
 * Use parseResourceId() on the returned resourceId if you need entityDefinitionId/entityInstanceId.
 */
export function parseFieldValueKey(key: FieldValueKey): {
  resourceId: ResourceId
  fieldId: FieldId
  entityDefinitionId: string
  entityInstanceId: string
} {
  const parts = key.split(':')
  if (parts.length < 3) {
    console.error('[parseFieldValueKey] Malformed key:', key)
    return {
      resourceId: key as unknown as ResourceId,
      fieldId: '' as FieldId,
      entityDefinitionId: '',
      entityInstanceId: '',
    }
  }
  const entityDefinitionId = parts[0]!
  const entityInstanceId = parts[1]!
  const fieldId = parts.slice(2).join(':') as FieldId // Handle fieldIds that might contain colons
  const { entityDefinitionId: parsedDefId, entityInstanceId: parsedInstId } = parseResourceId(
    toResourceId(entityDefinitionId, entityInstanceId),
  )

  return {
    resourceId: toResourceId(entityDefinitionId, entityInstanceId),
    fieldId,
    entityDefinitionId: parsedDefId,
    entityInstanceId: parsedInstId,
  }
}

/**
 * Check if a key matches a resource (any field on that resource).
 */
export function fieldValueKeyMatchesResource(key: FieldValueKey, resourceId: ResourceId): boolean {
  return key.startsWith(`${resourceId}:`)
}

/**
 * Check if a key matches a specific field (on any resource).
 */
export function fieldValueKeyMatchesField(key: FieldValueKey, fieldId: FieldId | string): boolean {
  return key.endsWith(`:${fieldId}`)
}

// ─────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────

export const useCustomFieldValueStore = create<CustomFieldValueState>()(
  subscribeWithSelector((set, get) => ({
    values: {},
    loadingBatches: {},
    updatedAt: {},
    pendingUpdates: {},
    mutationVersions: {},

    // ─── SETTERS ────────────────────────────────────────────────────

    setValues: (entries) => {
      const now = Date.now()
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const { key, value } of entries) {
          newValues[key] = value
          newUpdatedAt[key] = now
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    setValue: (key, value) => {
      set((state) => ({
        values: { ...state.values, [key]: value },
        updatedAt: { ...state.updatedAt, [key]: Date.now() },
      }))
    },

    setValueOptimistic: (key, newValue) => {
      set((state) => {
        const original = state.values[key]
        return {
          values: { ...state.values, [key]: newValue },
          pendingUpdates: {
            ...state.pendingUpdates,
            [key]: { value: newValue, original },
          },
          updatedAt: { ...state.updatedAt, [key]: Date.now() },
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

    // ─── INVALIDATION ───────────────────────────────────────────────

    invalidateResource: (resourceId) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (fieldValueKeyMatchesResource(key as FieldValueKey, resourceId)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateField: (fieldId) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (fieldValueKeyMatchesField(key as FieldValueKey, fieldId)) {
            delete newValues[key as FieldValueKey]
            delete newUpdatedAt[key as FieldValueKey]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateResources: (resourceIds) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }
        const resourceIdSet = new Set(resourceIds)

        for (const key of Object.keys(newValues)) {
          const { resourceId } = parseFieldValueKey(key as FieldValueKey)
          if (resourceIdSet.has(resourceId)) {
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
      set({ values: {}, loadingBatches: {}, updatedAt: {}, pendingUpdates: {}, mutationVersions: {} })
    },

    // ─── GETTERS ────────────────────────────────────────────────────

    isKeyLoading: (key) => {
      const { loadingBatches } = get()
      for (const batch of Object.values(loadingBatches)) {
        if (batch.keys.has(key)) return true
      }
      return false
    },

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
// SELECTOR HOOKS (for fine-grained subscriptions)
// ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to a field value and its loading state.
 * Component only re-renders when this specific value or loading state changes.
 *
 * Supports two call signatures:
 * - useFieldValue(key: FieldValueKey)
 * - useFieldValue(resourceId: ResourceId, fieldId: FieldId | string)
 */
export function useFieldValue(key: FieldValueKey): { value: StoredFieldValue | undefined; isLoading: boolean }
export function useFieldValue(resourceId: ResourceId, fieldId: FieldId | string): { value: StoredFieldValue | undefined; isLoading: boolean }
export function useFieldValue(
  keyOrResourceId: FieldValueKey | ResourceId,
  fieldId?: FieldId | string,
): { value: StoredFieldValue | undefined; isLoading: boolean } {
  // Determine the actual key based on arguments
  const key = fieldId !== undefined
    ? buildFieldValueKey(keyOrResourceId as ResourceId, fieldId)
    : (keyOrResourceId as FieldValueKey)

  // Stable selector that subscribes to both value and loading state
  const selector = useCallback(
    (state: CustomFieldValueState) => ({
      value: state.values[key],
      isLoading: state.isKeyLoading(key),
    }),
    [key]
  )

  // Use shallow comparison to prevent unnecessary re-renders
  return useCustomFieldValueStore(useShallow(selector))
}

/**
 * Get multiple values for a single resource (e.g., for entity-fields.tsx drawer).
 * Uses stable selector with useShallow for memoization to prevent infinite loops.
 */
export function useResourceFieldValues(
  resourceId: ResourceId,
  fieldIds: (FieldId | string)[],
): Record<string, StoredFieldValue | undefined> {
  // Stabilize inputs - only change selector when actual content changes
  const fieldIdsKey = fieldIds.join(',')

  // Create stable selector that only changes when inputs change
  const selector = useCallback(
    (state: CustomFieldValueState) => {
      const result: Record<string, StoredFieldValue | undefined> = {}
      for (const fieldId of fieldIds) {
        const key = buildFieldValueKey(resourceId, fieldId)
        result[fieldId] = state.values[key]
      }
      return result
    },
    [fieldIdsKey, resourceId]
  )

  // Wrap stable selector with useShallow for shallow comparison
  const memoizedSelector = useShallow(selector)

  return useCustomFieldValueStore(memoizedSelector)
}

// ─────────────────────────────────────────────────────────────────
// RE-EXPORTS for convenience
// ─────────────────────────────────────────────────────────────────
export { toResourceId, parseResourceId, type ResourceId } from '@auxx/lib/resources/client'
