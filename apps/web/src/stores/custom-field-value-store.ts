// apps/web/src/stores/custom-field-value-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { TypedFieldValue } from '@auxx/types/field-value'

/** Resource types that support custom fields */
export type ResourceType = 'contact' | 'ticket' | 'entity'

/** Key format: `${resourceType}:${entityDefId?}:${resourceId}:${fieldId}` */
export type ValueKey = string

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
  values: Record<ValueKey, StoredFieldValue>

  /** Keys currently being fetched (for dedup) - keyed by batch ID */
  loadingBatches: Record<string, LoadingBatch>

  /** Timestamp of last update per key (for staleness checks) */
  updatedAt: Record<ValueKey, number>

  /** Pending optimistic updates (key → {newValue, originalValue}) */
  pendingUpdates: Record<ValueKey, PendingUpdate>

  // ─────────────────────────────────────────────────────────────────
  // SETTERS
  // ─────────────────────────────────────────────────────────────────

  /** Set multiple values (batch update from API) */
  setValues: (entries: Array<{ key: ValueKey; value: StoredFieldValue }>) => void

  /** Set a single value (optimistic update on save) */
  setValue: (key: ValueKey, value: StoredFieldValue) => void

  /** Set value optimistically (stores original for rollback) */
  setValueOptimistic: (key: ValueKey, newValue: StoredFieldValue) => void

  /** Confirm optimistic update succeeded */
  confirmOptimistic: (key: ValueKey) => void

  /** Rollback optimistic update on error */
  rollbackOptimistic: (key: ValueKey) => void

  /** Mark a batch of keys as loading */
  startLoading: (batchId: string, keys: ValueKey[]) => void

  /** Clear loading state for a batch */
  finishLoading: (batchId: string) => void

  // ─────────────────────────────────────────────────────────────────
  // INVALIDATION (crucial for correctness)
  // ─────────────────────────────────────────────────────────────────

  /** Invalidate a single resource (after updating a contact/ticket/entity) */
  invalidateResource: (
    resourceType: ResourceType,
    resourceId: string,
    entityDefId?: string
  ) => void

  /** Invalidate a specific field across all resources (after field definition change) */
  invalidateField: (fieldId: string) => void

  /** Invalidate multiple resources (after bulk update) */
  invalidateResources: (
    resourceType: ResourceType,
    resourceIds: string[],
    entityDefId?: string
  ) => void

  /** Invalidate all values for a resource type (nuclear option) */
  invalidateResourceType: (resourceType: ResourceType, entityDefId?: string) => void

  /** Clear everything (on logout, org switch, etc.) */
  clearAll: () => void

  // ─────────────────────────────────────────────────────────────────
  // GETTERS (for imperative access)
  // ─────────────────────────────────────────────────────────────────

  /** Check if a key is currently being fetched */
  isKeyLoading: (key: ValueKey) => boolean

  /** Check if a value exists in cache */
  hasValue: (key: ValueKey) => boolean
}

// ─────────────────────────────────────────────────────────────────
// KEY HELPERS
// ─────────────────────────────────────────────────────────────────

/** Build a value key - uses : separator for easier parsing */
export function buildValueKey(
  resourceType: ResourceType,
  resourceId: string,
  fieldId: string,
  entityDefId?: string
): ValueKey {
  if (resourceType === 'entity' && entityDefId) {
    return `entity:${entityDefId}:${resourceId}:${fieldId}`
  }
  return `${resourceType}::${resourceId}:${fieldId}`
}

/** Parse a value key back to components */
export function parseValueKey(key: ValueKey): {
  resourceType: ResourceType
  entityDefId: string | undefined
  resourceId: string
  fieldId: string
} {
  const [resourceType, entityDefId, resourceId, fieldId] = key.split(':')
  return {
    resourceType: resourceType as ResourceType,
    entityDefId: entityDefId || undefined,
    resourceId: resourceId!,
    fieldId: fieldId!,
  }
}

/** Check if a key matches a resource */
export function keyMatchesResource(
  key: ValueKey,
  resourceType: ResourceType,
  resourceId: string,
  entityDefId?: string
): boolean {
  const parsed = parseValueKey(key)
  return (
    parsed.resourceType === resourceType &&
    parsed.resourceId === resourceId &&
    (resourceType !== 'entity' || parsed.entityDefId === entityDefId)
  )
}

/** Check if a key matches a field */
export function keyMatchesField(key: ValueKey, fieldId: string): boolean {
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

    invalidateResource: (resourceType, resourceId, entityDefId) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (keyMatchesResource(key, resourceType, resourceId, entityDefId)) {
            delete newValues[key]
            delete newUpdatedAt[key]
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
          if (keyMatchesField(key, fieldId)) {
            delete newValues[key]
            delete newUpdatedAt[key]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateResources: (resourceType, resourceIds, entityDefId) => {
      set((state) => {
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }
        const resourceIdSet = new Set(resourceIds)

        for (const key of Object.keys(newValues)) {
          const parsed = parseValueKey(key)
          if (
            parsed.resourceType === resourceType &&
            resourceIdSet.has(parsed.resourceId) &&
            (resourceType !== 'entity' || parsed.entityDefId === entityDefId)
          ) {
            delete newValues[key]
            delete newUpdatedAt[key]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    invalidateResourceType: (resourceType, entityDefId) => {
      set((state) => {
        const prefix = entityDefId ? `entity:${entityDefId}:` : `${resourceType}:`
        const newValues = { ...state.values }
        const newUpdatedAt = { ...state.updatedAt }

        for (const key of Object.keys(newValues)) {
          if (key.startsWith(prefix)) {
            delete newValues[key]
            delete newUpdatedAt[key]
          }
        }

        return { values: newValues, updatedAt: newUpdatedAt }
      })
    },

    clearAll: () => {
      set({ values: {}, loadingBatches: {}, updatedAt: {}, pendingUpdates: {} })
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
  }))
)

// ─────────────────────────────────────────────────────────────────
// SELECTOR HOOKS (for fine-grained subscriptions)
// ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to a single value. Component only re-renders when this specific value changes.
 */
export function useCustomFieldValue(
  resourceType: ResourceType,
  resourceId: string,
  fieldId: string,
  entityDefId?: string
): StoredFieldValue | undefined {
  const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)
  return useCustomFieldValueStore((state) => state.values[key])
}

/**
 * Subscribe to loading state for a specific value.
 */
export function useCustomFieldValueLoading(
  resourceType: ResourceType,
  resourceId: string,
  fieldId: string,
  entityDefId?: string
): boolean {
  const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)
  return useCustomFieldValueStore((state) => state.isKeyLoading(key))
}

/**
 * Get multiple values for a single resource (e.g., for entity-fields.tsx drawer).
 * Returns a stable object reference when values haven't changed.
 */
export function useResourceFieldValues(
  resourceType: ResourceType,
  resourceId: string,
  fieldIds: string[],
  entityDefId?: string
): Record<string, StoredFieldValue | undefined> {
  return useCustomFieldValueStore((state) => {
    const result: Record<string, StoredFieldValue | undefined> = {}
    for (const fieldId of fieldIds) {
      const key = buildValueKey(resourceType, resourceId, fieldId, entityDefId)
      result[fieldId] = state.values[key]
    }
    return result
  })
}
