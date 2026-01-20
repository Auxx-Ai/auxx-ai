// apps/web/src/components/resources/store/resource-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'
import { isCustomResource } from '@auxx/lib/resources/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId, parseResourceFieldId } from '@auxx/types/field'
import { shallowEqual, deepEqual } from '@auxx/utils/objects'

/**
 * Pending optimistic field update state
 */
interface PendingFieldUpdate {
  /** Optimistic updates to apply */
  optimistic: Partial<ResourceField>
  /** Original field for rollback */
  original: ResourceField
}

/**
 * Resource store state
 */
interface ResourceStoreState {
  // ─────────────────────────────────────────────────────────────────
  // SERVER STATE (confirmed by server)
  // ─────────────────────────────────────────────────────────────────

  /** All resources (system + custom) with embedded fields */
  resources: Resource[]

  /** Custom resources only (filtered) */
  customResources: CustomResource[]

  /** Map for O(1) lookups by id or apiSlug */
  resourceMap: Map<string, Resource>

  /** Server-confirmed field definitions by ResourceFieldId */
  serverFieldMap: Record<ResourceFieldId, ResourceField>

  // ─────────────────────────────────────────────────────────────────
  // OPTIMISTIC STATE
  // ─────────────────────────────────────────────────────────────────

  /** Pending field optimistic updates (key -> {optimistic, original}) */
  pendingFieldUpdates: Record<ResourceFieldId, PendingFieldUpdate>

  /** Optimistically added fields (not yet confirmed by server) */
  optimisticNewFields: Record<ResourceFieldId, ResourceField>

  /** Optimistically deleted fields (hidden from UI) */
  optimisticDeletedFields: Set<ResourceFieldId>

  // ─────────────────────────────────────────────────────────────────
  // VERSION TRACKING (race condition handling)
  // ─────────────────────────────────────────────────────────────────

  /** Mutation version per field key */
  fieldMutationVersions: Record<ResourceFieldId, number>

  // ─────────────────────────────────────────────────────────────────
  // LOADING & META
  // ─────────────────────────────────────────────────────────────────

  /** Loading state for initial resource fetch */
  isLoading: boolean

  /** Whether resources have been loaded at least once */
  hasLoadedOnce: boolean

  /** Timestamp of last fetch */
  lastFetchTimestamp: number

  // ─────────────────────────────────────────────────────────────────
  // COMPUTED (for backward compatibility)
  // ─────────────────────────────────────────────────────────────────

  /** Field-level lookup map with optimistic overlay (O(1) lookups by ResourceFieldId) */
  fieldMap: Record<ResourceFieldId, ResourceField>

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set resources (rebuilds map and filters custom resources) */
  setResources: (resources: Resource[]) => void

  /** Set loading state */
  setLoading: (isLoading: boolean) => void

  /** Get resource by entityDefinitionId or apiSlug (stable reference) */
  getResourceById: (entityDefinitionIdOrApiSlug: string) => Resource | undefined

  /** Get effective field (server + optimistic overlay) */
  getEffectiveField: (key: ResourceFieldId) => ResourceField | undefined

  /** Get effective resource with optimistic field overlays */
  getEffectiveResource: (entityDefinitionId: string) => Resource | undefined

  // ─────────────────────────────────────────────────────────────────
  // OPTIMISTIC UPDATE ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Apply optimistic field update (stores original for rollback) */
  setFieldOptimistic: (key: ResourceFieldId, updates: Partial<ResourceField>) => void

  /** Confirm field update succeeded - clears pending state */
  confirmFieldUpdate: (key: ResourceFieldId, serverField?: ResourceField) => void

  /** Rollback field update on error - restores original */
  rollbackFieldUpdate: (key: ResourceFieldId) => void

  /** Apply a field update from server response */
  applyFieldFromServer: (key: ResourceFieldId, field: ResourceField) => void

  /** Apply multiple fields from server (for relationships) */
  applyFieldsFromServer: (fields: Array<{ key: ResourceFieldId; field: ResourceField }>) => void

  /** Add optimistic new field (before server confirms) */
  addOptimisticField: (key: ResourceFieldId, field: ResourceField) => void

  /** Confirm field creation succeeded */
  confirmFieldCreate: (tempKey: ResourceFieldId, serverKey: ResourceFieldId, serverField: ResourceField) => void

  /** Rollback field creation on error */
  rollbackFieldCreate: (key: ResourceFieldId) => void

  /** Mark field as deleted (optimistic) */
  markFieldDeleted: (key: ResourceFieldId) => void

  /** Confirm field deletion succeeded */
  confirmFieldDelete: (key: ResourceFieldId) => void

  /** Rollback field deletion on error */
  rollbackFieldDelete: (key: ResourceFieldId) => void

  // ─────────────────────────────────────────────────────────────────
  // VERSION TRACKING ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Increment mutation version for a field, returns new version */
  incrementFieldVersion: (key: ResourceFieldId) => number

  /** Get current mutation version for a field */
  getFieldVersion: (key: ResourceFieldId) => number

  /** Reset store to initial state */
  reset: () => void
}

/**
 * Check if two fields have the same content (for reference stability).
 * Only compare properties that matter for field definition.
 */
function isFieldContentEqual(a: ResourceField, b: ResourceField): boolean {
  // Compare primitive properties
  if (
    a.id !== b.id ||
    a.key !== b.key ||
    a.label !== b.label ||
    a.type !== b.type ||
    a.fieldType !== b.fieldType ||
    a.sortOrder !== b.sortOrder ||
    a.active !== b.active
  ) {
    return false
  }

  // Compare capabilities
  if (!shallowEqual(a.capabilities, b.capabilities)) {
    return false
  }

  // Compare relationship config (deep)
  if (!deepEqual(a.relationship, b.relationship)) {
    return false
  }

  // Compare options (includes select options)
  if (!deepEqual(a.options, b.options)) {
    return false
  }

  return true
}

/**
 * Build fieldMap with optimistic overlay applied.
 * This is the effective view of all fields (server + pending changes).
 */
function buildEffectiveFieldMap(
  serverFieldMap: Record<ResourceFieldId, ResourceField>,
  pendingFieldUpdates: Record<ResourceFieldId, PendingFieldUpdate>,
  optimisticNewFields: Record<ResourceFieldId, ResourceField>,
  optimisticDeletedFields: Set<ResourceFieldId>,
  prevFieldMap: Record<ResourceFieldId, ResourceField>
): Record<ResourceFieldId, ResourceField> {
  const newFieldMap: Record<ResourceFieldId, ResourceField> = {}

  // Apply server fields with pending updates overlaid
  for (const [key, serverField] of Object.entries(serverFieldMap) as Array<[ResourceFieldId, ResourceField]>) {
    // Skip if deleted
    if (optimisticDeletedFields.has(key)) continue

    const pending = pendingFieldUpdates[key]
    let effectiveField: ResourceField

    if (pending) {
      // Merge server field with optimistic updates
      effectiveField = { ...serverField, ...pending.optimistic }
    } else {
      effectiveField = serverField
    }

    // Check if we can reuse the previous reference
    const prevField = prevFieldMap[key]
    if (prevField && isFieldContentEqual(prevField, effectiveField)) {
      newFieldMap[key] = prevField
    } else {
      newFieldMap[key] = effectiveField
    }
  }

  // Add optimistically created fields
  for (const [key, field] of Object.entries(optimisticNewFields) as Array<[ResourceFieldId, ResourceField]>) {
    if (!optimisticDeletedFields.has(key)) {
      newFieldMap[key] = field
    }
  }

  return newFieldMap
}

/**
 * Initial state
 */
const initialState = {
  resources: [],
  customResources: [],
  isLoading: false,
  hasLoadedOnce: false,
  lastFetchTimestamp: 0,
  resourceMap: new Map<string, Resource>(),
  serverFieldMap: {} as Record<ResourceFieldId, ResourceField>,
  fieldMap: {} as Record<ResourceFieldId, ResourceField>,
  pendingFieldUpdates: {} as Record<ResourceFieldId, PendingFieldUpdate>,
  optimisticNewFields: {} as Record<ResourceFieldId, ResourceField>,
  optimisticDeletedFields: new Set<ResourceFieldId>(),
  fieldMutationVersions: {} as Record<ResourceFieldId, number>,
}

/**
 * Resource store - centralized resource data with selective subscriptions and optimistic updates
 */
export const useResourceStore = create<ResourceStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    setResources: (resources) => {
      const state = get()

      // Build map for O(1) lookups
      const resourceMap = new Map<string, Resource>()
      resources.forEach((r) => {
        resourceMap.set(r.id, r)
        if (r.apiSlug) {
          resourceMap.set(r.apiSlug, r)
        }
      })

      // Filter custom resources
      const customResources = resources.filter(isCustomResource)

      // Build server field map
      const serverFieldMap: Record<ResourceFieldId, ResourceField> = {}
      resources.forEach((resource) => {
        resource.fields.forEach((field) => {
          const resourceFieldId = field.resourceFieldId || toResourceFieldId(resource.id, field.id)
          serverFieldMap[resourceFieldId] = { ...field, resourceFieldId }
        })
      })

      // Clean up pending updates that match server state
      const newPendingFieldUpdates = { ...state.pendingFieldUpdates }
      for (const [key, pending] of Object.entries(newPendingFieldUpdates) as Array<[ResourceFieldId, PendingFieldUpdate]>) {
        const serverField = serverFieldMap[key]
        if (serverField) {
          const mergedField = { ...pending.original, ...pending.optimistic }
          if (isFieldContentEqual(serverField, mergedField as ResourceField)) {
            // Server has the optimistic value - mutation succeeded
            delete newPendingFieldUpdates[key]
          }
        }
      }

      // Clean up optimistic new fields that now exist on server
      const newOptimisticNewFields = { ...state.optimisticNewFields }
      for (const key of Object.keys(newOptimisticNewFields) as ResourceFieldId[]) {
        if (serverFieldMap[key]) {
          delete newOptimisticNewFields[key]
        }
      }

      // Clean up optimistic deleted fields that no longer exist on server
      const newOptimisticDeletedFields = new Set(state.optimisticDeletedFields)
      for (const key of newOptimisticDeletedFields) {
        if (!serverFieldMap[key]) {
          newOptimisticDeletedFields.delete(key)
        }
      }

      // Build effective fieldMap with optimistic overlay
      const fieldMap = buildEffectiveFieldMap(
        serverFieldMap,
        newPendingFieldUpdates,
        newOptimisticNewFields,
        newOptimisticDeletedFields,
        state.fieldMap
      )

      set({
        resources,
        customResources,
        resourceMap,
        serverFieldMap,
        fieldMap,
        pendingFieldUpdates: newPendingFieldUpdates,
        optimisticNewFields: newOptimisticNewFields,
        optimisticDeletedFields: newOptimisticDeletedFields,
        hasLoadedOnce: true,
        lastFetchTimestamp: Date.now(),
      })
    },

    setLoading: (isLoading) => {
      set({ isLoading })
    },

    getResourceById: (entityDefinitionIdOrApiSlug) => {
      return get().resourceMap.get(entityDefinitionIdOrApiSlug)
    },

    getEffectiveField: (key) => {
      const state = get()

      // Check if deleted
      if (state.optimisticDeletedFields.has(key)) {
        return undefined
      }

      // Check optimistic new fields
      if (state.optimisticNewFields[key]) {
        return state.optimisticNewFields[key]
      }

      // Get server field
      const serverField = state.serverFieldMap[key]
      if (!serverField) return undefined

      // Apply pending optimistic updates
      const pending = state.pendingFieldUpdates[key]
      if (pending) {
        return { ...serverField, ...pending.optimistic }
      }

      return serverField
    },

    getEffectiveResource: (entityDefinitionId) => {
      const state = get()
      const resource = state.resourceMap.get(entityDefinitionId)
      if (!resource) return undefined

      // Build effective fields list with optimistic overlay
      const effectiveFields: ResourceField[] = []

      for (const field of resource.fields) {
        const key = field.resourceFieldId || toResourceFieldId(resource.id, field.id)

        // Skip deleted
        if (state.optimisticDeletedFields.has(key)) continue

        const effectiveField = state.getEffectiveField(key)
        if (effectiveField) {
          effectiveFields.push(effectiveField)
        }
      }

      // Add optimistic new fields for this resource
      for (const [key, field] of Object.entries(state.optimisticNewFields) as Array<[ResourceFieldId, ResourceField]>) {
        const { entityDefinitionId: fieldDefId } = parseResourceFieldId(key)
        if (fieldDefId === entityDefinitionId && !state.optimisticDeletedFields.has(key)) {
          effectiveFields.push(field)
        }
      }

      return { ...resource, fields: effectiveFields }
    },

    // ─── OPTIMISTIC UPDATE ACTIONS ─────────────────────────────────────

    setFieldOptimistic: (key, updates) => {
      set((state) => {
        const serverField = state.serverFieldMap[key]
        if (!serverField) {
          console.warn(`[setFieldOptimistic] Field not found: ${key}`)
          return state
        }

        // Store original for rollback (use existing pending original if already pending)
        const existingPending = state.pendingFieldUpdates[key]
        const original = existingPending?.original ?? serverField

        const newPendingFieldUpdates = {
          ...state.pendingFieldUpdates,
          [key]: { optimistic: updates, original },
        }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          newPendingFieldUpdates,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return { pendingFieldUpdates: newPendingFieldUpdates, fieldMap }
      })
    },

    confirmFieldUpdate: (key, serverField) => {
      set((state) => {
        const { [key]: _, ...restPending } = state.pendingFieldUpdates

        // If server field provided, update the server field map
        let newServerFieldMap = state.serverFieldMap
        if (serverField) {
          newServerFieldMap = { ...state.serverFieldMap, [key]: serverField }
        }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          newServerFieldMap,
          restPending,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return {
          serverFieldMap: newServerFieldMap,
          pendingFieldUpdates: restPending,
          fieldMap,
        }
      })
    },

    rollbackFieldUpdate: (key) => {
      set((state) => {
        const { [key]: _, ...restPending } = state.pendingFieldUpdates

        // Rebuild effective fieldMap (will use server values)
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          restPending,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return { pendingFieldUpdates: restPending, fieldMap }
      })
    },

    applyFieldFromServer: (key, field) => {
      set((state) => {
        // Update server field map
        const newServerFieldMap = { ...state.serverFieldMap, [key]: field }

        // Clear any pending update for this key
        const { [key]: _, ...restPending } = state.pendingFieldUpdates

        // Also update the resource's fields array
        const { entityDefinitionId } = parseResourceFieldId(key)
        const newResources = state.resources.map((resource) => {
          if (resource.id !== entityDefinitionId) return resource
          return {
            ...resource,
            fields: resource.fields.map((f) =>
              (f.resourceFieldId || toResourceFieldId(resource.id, f.id)) === key ? field : f
            ),
          }
        })

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          newServerFieldMap,
          restPending,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return {
          serverFieldMap: newServerFieldMap,
          pendingFieldUpdates: restPending,
          resources: newResources,
          fieldMap,
        }
      })
    },

    applyFieldsFromServer: (fields) => {
      set((state) => {
        const newServerFieldMap = { ...state.serverFieldMap }
        let newPendingFieldUpdates = { ...state.pendingFieldUpdates }
        let newResources = state.resources

        for (const { key, field } of fields) {
          newServerFieldMap[key] = field
          const { [key]: _, ...rest } = newPendingFieldUpdates
          newPendingFieldUpdates = rest

          // Update resource fields array
          const { entityDefinitionId } = parseResourceFieldId(key)
          newResources = newResources.map((resource) => {
            if (resource.id !== entityDefinitionId) return resource
            return {
              ...resource,
              fields: resource.fields.map((f) =>
                (f.resourceFieldId || toResourceFieldId(resource.id, f.id)) === key ? field : f
              ),
            }
          })
        }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          newServerFieldMap,
          newPendingFieldUpdates,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return {
          serverFieldMap: newServerFieldMap,
          pendingFieldUpdates: newPendingFieldUpdates,
          resources: newResources,
          fieldMap,
        }
      })
    },

    addOptimisticField: (key, field) => {
      set((state) => {
        const newOptimisticNewFields = { ...state.optimisticNewFields, [key]: field }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          state.pendingFieldUpdates,
          newOptimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return { optimisticNewFields: newOptimisticNewFields, fieldMap }
      })
    },

    confirmFieldCreate: (tempKey, serverKey, serverField) => {
      set((state) => {
        // Remove from optimistic new fields
        const { [tempKey]: _, ...restOptimistic } = state.optimisticNewFields

        // Add to server field map
        const newServerFieldMap = { ...state.serverFieldMap, [serverKey]: serverField }

        // Add the new field to the resource's fields array
        const { entityDefinitionId } = parseResourceFieldId(serverKey)
        const newResources = state.resources.map((resource) => {
          if (resource.id !== entityDefinitionId && resource.entityDefinitionId !== entityDefinitionId) {
            return resource
          }
          // Check if field already exists (avoid duplicates)
          const fieldExists = resource.fields.some(
            (f) => f.id === serverField.id || f.resourceFieldId === serverKey
          )
          if (fieldExists) return resource

          return {
            ...resource,
            fields: [...resource.fields, serverField],
          }
        })

        // Update resourceMap with new resources
        const newResourceMap = new Map(state.resourceMap)
        for (const resource of newResources) {
          newResourceMap.set(resource.id, resource)
          if (resource.apiSlug) {
            newResourceMap.set(resource.apiSlug, resource)
          }
        }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          newServerFieldMap,
          state.pendingFieldUpdates,
          restOptimistic,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return {
          optimisticNewFields: restOptimistic,
          serverFieldMap: newServerFieldMap,
          resources: newResources,
          resourceMap: newResourceMap,
          fieldMap,
        }
      })
    },

    rollbackFieldCreate: (key) => {
      set((state) => {
        const { [key]: _, ...restOptimistic } = state.optimisticNewFields

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          state.pendingFieldUpdates,
          restOptimistic,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return { optimisticNewFields: restOptimistic, fieldMap }
      })
    },

    markFieldDeleted: (key) => {
      set((state) => {
        const newOptimisticDeletedFields = new Set(state.optimisticDeletedFields)
        newOptimisticDeletedFields.add(key)

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          state.pendingFieldUpdates,
          state.optimisticNewFields,
          newOptimisticDeletedFields,
          state.fieldMap
        )

        return { optimisticDeletedFields: newOptimisticDeletedFields, fieldMap }
      })
    },

    confirmFieldDelete: (key) => {
      set((state) => {
        // Remove from optimistic deleted set
        const newOptimisticDeletedFields = new Set(state.optimisticDeletedFields)
        newOptimisticDeletedFields.delete(key)

        // Remove from server field map
        const { [key]: _, ...restServerFields } = state.serverFieldMap

        // Remove the field from the resource's fields array
        const { entityDefinitionId } = parseResourceFieldId(key)
        const newResources = state.resources.map((resource) => {
          if (resource.id !== entityDefinitionId && resource.entityDefinitionId !== entityDefinitionId) {
            return resource
          }
          return {
            ...resource,
            fields: resource.fields.filter(
              (f) => (f.resourceFieldId || toResourceFieldId(resource.id, f.id)) !== key
            ),
          }
        })

        // Update resourceMap with new resources
        const newResourceMap = new Map(state.resourceMap)
        for (const resource of newResources) {
          newResourceMap.set(resource.id, resource)
          if (resource.apiSlug) {
            newResourceMap.set(resource.apiSlug, resource)
          }
        }

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          restServerFields,
          state.pendingFieldUpdates,
          state.optimisticNewFields,
          newOptimisticDeletedFields,
          state.fieldMap
        )

        return {
          optimisticDeletedFields: newOptimisticDeletedFields,
          serverFieldMap: restServerFields,
          resources: newResources,
          resourceMap: newResourceMap,
          fieldMap,
        }
      })
    },

    rollbackFieldDelete: (key) => {
      set((state) => {
        const newOptimisticDeletedFields = new Set(state.optimisticDeletedFields)
        newOptimisticDeletedFields.delete(key)

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          state.serverFieldMap,
          state.pendingFieldUpdates,
          state.optimisticNewFields,
          newOptimisticDeletedFields,
          state.fieldMap
        )

        return { optimisticDeletedFields: newOptimisticDeletedFields, fieldMap }
      })
    },

    // ─── VERSION TRACKING ──────────────────────────────────────────────

    incrementFieldVersion: (key) => {
      const current = get().fieldMutationVersions[key] ?? 0
      const next = current + 1
      set((state) => ({
        fieldMutationVersions: { ...state.fieldMutationVersions, [key]: next },
      }))
      return next
    },

    getFieldVersion: (key) => {
      return get().fieldMutationVersions[key] ?? 0
    },

    reset: () => {
      set({
        ...initialState,
        resourceMap: new Map<string, Resource>(),
        serverFieldMap: {} as Record<ResourceFieldId, ResourceField>,
        fieldMap: {} as Record<ResourceFieldId, ResourceField>,
        pendingFieldUpdates: {} as Record<ResourceFieldId, PendingFieldUpdate>,
        optimisticNewFields: {} as Record<ResourceFieldId, ResourceField>,
        optimisticDeletedFields: new Set<ResourceFieldId>(),
        fieldMutationVersions: {} as Record<ResourceFieldId, number>,
      })
    },
  }))
)

/**
 * Get resource store state imperatively
 */
export function getResourceStoreState() {
  return useResourceStore.getState()
}
