// apps/web/src/components/resources/store/resource-store.ts

import type { CustomResource, Resource, ResourceField } from '@auxx/lib/resources/client'
import { isCustomResource } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { parseResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { deepEqual, shallowEqual } from '@auxx/utils/objects'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

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
 * Pending optimistic resource update state
 */
interface PendingResourceUpdate {
  /** Optimistic updates to apply */
  optimistic: Partial<Resource>
  /** Original resource for rollback */
  original: Resource
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
  // FIELD OPTIMISTIC STATE
  // ─────────────────────────────────────────────────────────────────

  /** Pending field optimistic updates (key -> {optimistic, original}) */
  pendingFieldUpdates: Record<ResourceFieldId, PendingFieldUpdate>

  /** Optimistically added fields (not yet confirmed by server) */
  optimisticNewFields: Record<ResourceFieldId, ResourceField>

  /** Optimistically deleted fields (hidden from UI) */
  optimisticDeletedFields: Set<ResourceFieldId>

  // ─────────────────────────────────────────────────────────────────
  // RESOURCE OPTIMISTIC STATE
  // ─────────────────────────────────────────────────────────────────

  /** Pending resource optimistic updates (entityDefinitionId -> {optimistic, original}) */
  pendingResourceUpdates: Record<string, PendingResourceUpdate>

  /** Optimistically added resources (not yet confirmed by server) */
  optimisticNewResources: Record<string, Resource>

  /** Optimistically archived resources (hidden from UI) */
  optimisticArchivedResources: Set<string>

  // ─────────────────────────────────────────────────────────────────
  // VERSION TRACKING (race condition handling)
  // ─────────────────────────────────────────────────────────────────

  /** Mutation version per field key */
  fieldMutationVersions: Record<ResourceFieldId, number>

  /** Mutation version per resource key */
  resourceMutationVersions: Record<string, number>

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

  /** Global map for O(1) lookups: systemAttribute -> ResourceFieldId */
  systemAttributeMap: Record<string, ResourceFieldId>

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
  confirmFieldCreate: (
    tempKey: ResourceFieldId,
    serverKey: ResourceFieldId,
    serverField: ResourceField
  ) => void

  /** Rollback field creation on error */
  rollbackFieldCreate: (key: ResourceFieldId) => void

  /** Mark field as deleted (optimistic) */
  markFieldDeleted: (key: ResourceFieldId) => void

  /** Confirm field deletion succeeded */
  confirmFieldDelete: (key: ResourceFieldId) => void

  /** Rollback field deletion on error */
  rollbackFieldDelete: (key: ResourceFieldId) => void

  // ─────────────────────────────────────────────────────────────────
  // RESOURCE OPTIMISTIC UPDATE ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Apply optimistic resource update (stores original for rollback) */
  setResourceOptimistic: (entityDefinitionId: string, updates: Partial<Resource>) => void

  /** Confirm resource update succeeded - clears pending state */
  confirmResourceUpdate: (entityDefinitionId: string, serverResource?: Resource) => void

  /** Rollback resource update on error - restores original */
  rollbackResourceUpdate: (entityDefinitionId: string) => void

  /** Add optimistic new resource (before server confirms) */
  addOptimisticResource: (tempId: string, resource: Resource) => void

  /** Confirm resource creation succeeded */
  confirmResourceCreate: (tempId: string, serverResource: Resource) => void

  /** Rollback resource creation on error */
  rollbackResourceCreate: (tempId: string) => void

  /** Mark resource as archived (optimistic) */
  markResourceArchived: (entityDefinitionId: string) => void

  /** Confirm resource archive succeeded */
  confirmResourceArchive: (entityDefinitionId: string) => void

  /** Rollback resource archive on error */
  rollbackResourceArchive: (entityDefinitionId: string) => void

  /** Mark resource as restored (optimistic) */
  markResourceRestored: (entityDefinitionId: string) => void

  /** Confirm resource restore succeeded */
  confirmResourceRestore: (entityDefinitionId: string) => void

  /** Rollback resource restore on error */
  rollbackResourceRestore: (entityDefinitionId: string) => void

  /** Add a server-confirmed resource directly to the store */
  addServerResource: (resource: Resource) => void

  // ─────────────────────────────────────────────────────────────────
  // VERSION TRACKING ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Increment mutation version for a field, returns new version */
  incrementFieldVersion: (key: ResourceFieldId) => number

  /** Get current mutation version for a field */
  getFieldVersion: (key: ResourceFieldId) => number

  /** Increment mutation version for a resource, returns new version */
  incrementResourceVersion: (entityDefinitionId: string) => number

  /** Get current mutation version for a resource */
  getResourceVersion: (entityDefinitionId: string) => number

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
  for (const [key, serverField] of Object.entries(serverFieldMap) as Array<
    [ResourceFieldId, ResourceField]
  >) {
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
  for (const [key, field] of Object.entries(optimisticNewFields) as Array<
    [ResourceFieldId, ResourceField]
  >) {
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
  systemAttributeMap: {} as Record<string, ResourceFieldId>,
  // Field optimistic state
  pendingFieldUpdates: {} as Record<ResourceFieldId, PendingFieldUpdate>,
  optimisticNewFields: {} as Record<ResourceFieldId, ResourceField>,
  optimisticDeletedFields: new Set<ResourceFieldId>(),
  fieldMutationVersions: {} as Record<ResourceFieldId, number>,
  // Resource optimistic state
  pendingResourceUpdates: {} as Record<string, PendingResourceUpdate>,
  optimisticNewResources: {} as Record<string, Resource>,
  optimisticArchivedResources: new Set<string>(),
  resourceMutationVersions: {} as Record<string, number>,
}

/**
 * Resource store - centralized resource data with selective subscriptions and optimistic updates
 */
export const useResourceStore = create<ResourceStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    setResources: (resources) => {
      const state = get()

      // Build map for O(1) lookups by id, apiSlug, entityType, and entityDefinitionId
      const resourceMap = new Map<string, Resource>()
      resources.forEach((r) => {
        resourceMap.set(r.id, r)
        if (r.apiSlug) {
          resourceMap.set(r.apiSlug, r)
        }
        // Index by entityType for system resources (enables getResourceById('tag'))
        if (r.entityType) {
          resourceMap.set(r.entityType, r)
        }
        // Index by entityDefinitionId if different from id
        if (r.entityDefinitionId && r.entityDefinitionId !== r.id) {
          resourceMap.set(r.entityDefinitionId, r)
        }
      })

      // Filter custom resources
      const customResources = resources.filter(isCustomResource)

      // Build server field map and systemAttribute lookup map
      const serverFieldMap: Record<ResourceFieldId, ResourceField> = {}
      const systemAttributeMap: Record<string, ResourceFieldId> = {}
      const UNIVERSAL_ATTRIBUTES = ['id', 'record_id', 'created_at', 'updated_at']

      resources.forEach((resource) => {
        // Get entityType for universal field mapping (e.g., 'thread', 'contact', 'ticket')
        const entityType = resource.entityType || resource.apiSlug

        resource.fields.forEach((field) => {
          const resourceFieldId = field.resourceFieldId || toResourceFieldId(resource.id, field.id)
          serverFieldMap[resourceFieldId] = { ...field, resourceFieldId }

          // Build systemAttribute lookup map
          if (field.systemAttribute && entityType) {
            if (UNIVERSAL_ATTRIBUTES.includes(field.systemAttribute)) {
              // Universal fields: map to "{entityType}_{attribute}"
              // e.g., "thread_created_at", "contact_id"
              const mappedKey = `${entityType}_${field.systemAttribute}`
              systemAttributeMap[mappedKey] = resourceFieldId
            } else {
              // Unique fields: use systemAttribute directly as key
              systemAttributeMap[field.systemAttribute] = resourceFieldId
            }
          }
        })
      })

      // Clean up pending updates that match server state
      const newPendingFieldUpdates = { ...state.pendingFieldUpdates }
      for (const [key, pending] of Object.entries(newPendingFieldUpdates) as Array<
        [ResourceFieldId, PendingFieldUpdate]
      >) {
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

      // ─── RESOURCE OPTIMISTIC STATE RECONCILIATION ─────────────────────

      // Clean up pending resource updates that match server state
      const newPendingResourceUpdates = { ...state.pendingResourceUpdates }
      for (const [entityDefId, pending] of Object.entries(newPendingResourceUpdates)) {
        const serverResource = resources.find(
          (r) => r.entityDefinitionId === entityDefId || r.id === entityDefId
        )
        if (serverResource) {
          // Check if server has caught up with optimistic changes
          const optimisticKeys = Object.keys(pending.optimistic) as Array<keyof Resource>
          const serverMatchesOptimistic = optimisticKeys.every((key) => {
            const optimisticValue = pending.optimistic[key]
            const serverValue = serverResource[key]
            return optimisticValue === serverValue
          })
          if (serverMatchesOptimistic) {
            delete newPendingResourceUpdates[entityDefId]
          }
        }
      }

      // Clean up optimistic new resources that now exist on server
      const newOptimisticNewResources = { ...state.optimisticNewResources }
      for (const tempId of Object.keys(newOptimisticNewResources)) {
        const optimistic = newOptimisticNewResources[tempId]
        // Check if a resource with matching apiSlug exists on server
        const exists = resources.some((r) => r.apiSlug === optimistic.apiSlug)
        if (exists) {
          delete newOptimisticNewResources[tempId]
        }
      }

      // Clean up optimistic archived resources that no longer exist on server
      const newOptimisticArchivedResources = new Set(state.optimisticArchivedResources)
      for (const entityDefId of newOptimisticArchivedResources) {
        const stillExists = resources.some(
          (r) => r.entityDefinitionId === entityDefId || r.id === entityDefId
        )
        if (!stillExists) {
          newOptimisticArchivedResources.delete(entityDefId)
        }
      }

      set({
        resources,
        customResources,
        resourceMap,
        serverFieldMap,
        fieldMap,
        systemAttributeMap,
        // Field optimistic state
        pendingFieldUpdates: newPendingFieldUpdates,
        optimisticNewFields: newOptimisticNewFields,
        optimisticDeletedFields: newOptimisticDeletedFields,
        // Resource optimistic state
        pendingResourceUpdates: newPendingResourceUpdates,
        optimisticNewResources: newOptimisticNewResources,
        optimisticArchivedResources: newOptimisticArchivedResources,
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
      for (const [key, field] of Object.entries(state.optimisticNewFields) as Array<
        [ResourceFieldId, ResourceField]
      >) {
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
          if (
            resource.id !== entityDefinitionId &&
            resource.entityDefinitionId !== entityDefinitionId
          ) {
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
          if (
            resource.id !== entityDefinitionId &&
            resource.entityDefinitionId !== entityDefinitionId
          ) {
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

    // ─── RESOURCE OPTIMISTIC UPDATE ACTIONS ───────────────────────────

    setResourceOptimistic: (entityDefinitionId, updates) => {
      set((state) => {
        const resource = state.resourceMap.get(entityDefinitionId)
        if (!resource) {
          console.warn(`[setResourceOptimistic] Resource not found: ${entityDefinitionId}`)
          return state
        }

        // Store original for rollback (use existing pending original if already pending)
        const existingPending = state.pendingResourceUpdates[entityDefinitionId]
        const original = existingPending?.original ?? resource

        const newPendingResourceUpdates = {
          ...state.pendingResourceUpdates,
          [entityDefinitionId]: { optimistic: updates, original },
        }

        // Apply optimistic update to resource
        const updatedResource = { ...resource, ...updates }

        // Update resourceMap
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.set(entityDefinitionId, updatedResource)
        newResourceMap.set(resource.id, updatedResource)
        if (resource.apiSlug) {
          newResourceMap.set(resource.apiSlug, updatedResource)
        }

        // Update resources array
        const newResources = state.resources.map((r) =>
          r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
            ? updatedResource
            : r
        )

        // Update customResources if applicable
        const newCustomResources = isCustomResource(updatedResource)
          ? state.customResources.map((r) =>
              r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
                ? (updatedResource as CustomResource)
                : r
            )
          : state.customResources

        return {
          pendingResourceUpdates: newPendingResourceUpdates,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    confirmResourceUpdate: (entityDefinitionId, serverResource) => {
      set((state) => {
        const { [entityDefinitionId]: _, ...restPending } = state.pendingResourceUpdates

        // If server resource provided, update the store with server data
        if (serverResource) {
          const newResourceMap = new Map(state.resourceMap)
          newResourceMap.set(entityDefinitionId, serverResource)
          newResourceMap.set(serverResource.id, serverResource)
          if (serverResource.apiSlug) {
            newResourceMap.set(serverResource.apiSlug, serverResource)
          }

          const newResources = state.resources.map((r) =>
            r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
              ? serverResource
              : r
          )

          const newCustomResources = isCustomResource(serverResource)
            ? state.customResources.map((r) =>
                r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
                  ? (serverResource as CustomResource)
                  : r
              )
            : state.customResources

          return {
            pendingResourceUpdates: restPending,
            resourceMap: newResourceMap,
            resources: newResources,
            customResources: newCustomResources,
          }
        }

        return { pendingResourceUpdates: restPending }
      })
    },

    rollbackResourceUpdate: (entityDefinitionId) => {
      set((state) => {
        const pending = state.pendingResourceUpdates[entityDefinitionId]
        if (!pending) return state

        const { [entityDefinitionId]: _, ...restPending } = state.pendingResourceUpdates

        // Restore original resource
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.set(entityDefinitionId, pending.original)
        newResourceMap.set(pending.original.id, pending.original)
        if (pending.original.apiSlug) {
          newResourceMap.set(pending.original.apiSlug, pending.original)
        }

        const newResources = state.resources.map((r) =>
          r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
            ? pending.original
            : r
        )

        const newCustomResources = isCustomResource(pending.original)
          ? state.customResources.map((r) =>
              r.entityDefinitionId === entityDefinitionId || r.id === entityDefinitionId
                ? (pending.original as CustomResource)
                : r
            )
          : state.customResources

        return {
          pendingResourceUpdates: restPending,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    addOptimisticResource: (tempId, resource) => {
      set((state) => {
        const newOptimisticNewResources = { ...state.optimisticNewResources, [tempId]: resource }

        // Add to resourceMap for immediate lookup
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.set(tempId, resource)
        if (resource.apiSlug) {
          newResourceMap.set(resource.apiSlug, resource)
        }

        // Add to resources and customResources arrays
        const newResources = [...state.resources, resource]
        const newCustomResources = isCustomResource(resource)
          ? [...state.customResources, resource as CustomResource]
          : state.customResources

        return {
          optimisticNewResources: newOptimisticNewResources,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    confirmResourceCreate: (tempId, serverResource) => {
      set((state) => {
        // Remove from optimistic new resources
        const { [tempId]: _, ...restOptimistic } = state.optimisticNewResources

        // Update resourceMap: remove temp, add server resource
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.delete(tempId)
        newResourceMap.set(serverResource.entityDefinitionId, serverResource)
        newResourceMap.set(serverResource.id, serverResource)
        if (serverResource.apiSlug) {
          newResourceMap.set(serverResource.apiSlug, serverResource)
        }

        // Replace temp resource with server resource in arrays
        const newResources = state.resources.map((r) =>
          r.entityDefinitionId === tempId || r.id === tempId ? serverResource : r
        )

        const newCustomResources = isCustomResource(serverResource)
          ? state.customResources.map((r) =>
              r.entityDefinitionId === tempId || r.id === tempId
                ? (serverResource as CustomResource)
                : r
            )
          : state.customResources.filter((r) => r.entityDefinitionId !== tempId && r.id !== tempId)

        return {
          optimisticNewResources: restOptimistic,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    rollbackResourceCreate: (tempId) => {
      set((state) => {
        const { [tempId]: _, ...restOptimistic } = state.optimisticNewResources
        const optimisticResource = state.optimisticNewResources[tempId]

        // Remove from resourceMap
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.delete(tempId)
        if (optimisticResource?.apiSlug) {
          newResourceMap.delete(optimisticResource.apiSlug)
        }

        // Remove from arrays
        const newResources = state.resources.filter(
          (r) => r.entityDefinitionId !== tempId && r.id !== tempId
        )
        const newCustomResources = state.customResources.filter(
          (r) => r.entityDefinitionId !== tempId && r.id !== tempId
        )

        return {
          optimisticNewResources: restOptimistic,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    markResourceArchived: (entityDefinitionId) => {
      set((state) => {
        const resource = state.resourceMap.get(entityDefinitionId)
        if (!resource) return state

        const newOptimisticArchivedResources = new Set(state.optimisticArchivedResources)
        newOptimisticArchivedResources.add(entityDefinitionId)

        // Store original for rollback
        const newPendingResourceUpdates = {
          ...state.pendingResourceUpdates,
          [entityDefinitionId]: { optimistic: {}, original: resource },
        }

        // Remove from resourceMap
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.delete(entityDefinitionId)
        newResourceMap.delete(resource.id)
        if (resource.apiSlug) {
          newResourceMap.delete(resource.apiSlug)
        }

        // Remove from arrays
        const newResources = state.resources.filter(
          (r) => r.entityDefinitionId !== entityDefinitionId && r.id !== entityDefinitionId
        )
        const newCustomResources = state.customResources.filter(
          (r) => r.entityDefinitionId !== entityDefinitionId && r.id !== entityDefinitionId
        )

        return {
          optimisticArchivedResources: newOptimisticArchivedResources,
          pendingResourceUpdates: newPendingResourceUpdates,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    confirmResourceArchive: (entityDefinitionId) => {
      set((state) => {
        const newOptimisticArchivedResources = new Set(state.optimisticArchivedResources)
        newOptimisticArchivedResources.delete(entityDefinitionId)

        const { [entityDefinitionId]: _, ...restPending } = state.pendingResourceUpdates

        return {
          optimisticArchivedResources: newOptimisticArchivedResources,
          pendingResourceUpdates: restPending,
        }
      })
    },

    rollbackResourceArchive: (entityDefinitionId) => {
      set((state) => {
        const pending = state.pendingResourceUpdates[entityDefinitionId]
        if (!pending) return state

        const newOptimisticArchivedResources = new Set(state.optimisticArchivedResources)
        newOptimisticArchivedResources.delete(entityDefinitionId)

        const { [entityDefinitionId]: _, ...restPending } = state.pendingResourceUpdates

        // Restore to resourceMap
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.set(entityDefinitionId, pending.original)
        newResourceMap.set(pending.original.id, pending.original)
        if (pending.original.apiSlug) {
          newResourceMap.set(pending.original.apiSlug, pending.original)
        }

        // Add back to arrays
        const newResources = [...state.resources, pending.original]
        const newCustomResources = isCustomResource(pending.original)
          ? [...state.customResources, pending.original as CustomResource]
          : state.customResources

        return {
          optimisticArchivedResources: newOptimisticArchivedResources,
          pendingResourceUpdates: restPending,
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
        }
      })
    },

    markResourceRestored: (entityDefinitionId) => {
      set((state) => {
        // For restore, we don't have the resource in the current state
        // This is typically called when restoring from archived resources
        // The resource will come from the server response
        return state
      })
    },

    confirmResourceRestore: (entityDefinitionId) => {
      // Typically handled by setResources when server data arrives
      return
    },

    rollbackResourceRestore: (entityDefinitionId) => {
      // If restore fails, we don't need to do anything since the resource
      // wasn't added to the visible lists yet
      return
    },

    addServerResource: (resource) => {
      set((state) => {
        // Add to resourceMap
        const newResourceMap = new Map(state.resourceMap)
        newResourceMap.set(resource.id, resource)
        newResourceMap.set(resource.entityDefinitionId, resource)
        if (resource.apiSlug) {
          newResourceMap.set(resource.apiSlug, resource)
        }

        // Add to arrays
        const newResources = [...state.resources, resource]
        const newCustomResources = isCustomResource(resource)
          ? [...state.customResources, resource as CustomResource]
          : state.customResources

        // Build field map entries for this resource's fields
        const newServerFieldMap = { ...state.serverFieldMap }
        resource.fields.forEach((field) => {
          const resourceFieldId = field.resourceFieldId || toResourceFieldId(resource.id, field.id)
          newServerFieldMap[resourceFieldId] = { ...field, resourceFieldId }
        })

        // Rebuild effective fieldMap
        const fieldMap = buildEffectiveFieldMap(
          newServerFieldMap,
          state.pendingFieldUpdates,
          state.optimisticNewFields,
          state.optimisticDeletedFields,
          state.fieldMap
        )

        return {
          resourceMap: newResourceMap,
          resources: newResources,
          customResources: newCustomResources,
          serverFieldMap: newServerFieldMap,
          fieldMap,
        }
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

    incrementResourceVersion: (entityDefinitionId) => {
      const current = get().resourceMutationVersions[entityDefinitionId] ?? 0
      const next = current + 1
      set((state) => ({
        resourceMutationVersions: { ...state.resourceMutationVersions, [entityDefinitionId]: next },
      }))
      return next
    },

    getResourceVersion: (entityDefinitionId) => {
      return get().resourceMutationVersions[entityDefinitionId] ?? 0
    },

    reset: () => {
      set({
        ...initialState,
        resourceMap: new Map<string, Resource>(),
        serverFieldMap: {} as Record<ResourceFieldId, ResourceField>,
        fieldMap: {} as Record<ResourceFieldId, ResourceField>,
        systemAttributeMap: {} as Record<string, ResourceFieldId>,
        // Field optimistic state
        pendingFieldUpdates: {} as Record<ResourceFieldId, PendingFieldUpdate>,
        optimisticNewFields: {} as Record<ResourceFieldId, ResourceField>,
        optimisticDeletedFields: new Set<ResourceFieldId>(),
        fieldMutationVersions: {} as Record<ResourceFieldId, number>,
        // Resource optimistic state
        pendingResourceUpdates: {} as Record<string, PendingResourceUpdate>,
        optimisticNewResources: {} as Record<string, Resource>,
        optimisticArchivedResources: new Set<string>(),
        resourceMutationVersions: {} as Record<string, number>,
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
