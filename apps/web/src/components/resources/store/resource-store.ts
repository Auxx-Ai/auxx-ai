// apps/web/src/components/resources/store/resource-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'
import { isCustomResource } from '@auxx/lib/resources/client'
import type { ResourceField } from '@auxx/lib/resources/registry/field-types'
import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { shallowEqual, deepEqual } from '@auxx/utils/objects'

/**
 * Resource store state
 */
interface ResourceStoreState {
  // ─────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────

  /** All resources (system + custom) with embedded fields */
  resources: Resource[]

  /** Custom resources only (filtered) */
  customResources: CustomResource[]

  /** Loading state for initial resource fetch */
  isLoading: boolean

  /** Whether resources have been loaded at least once */
  hasLoadedOnce: boolean

  /** Map for O(1) lookups by id or apiSlug */
  resourceMap: Map<string, Resource>

  /** Field-level lookup map for granular subscriptions (O(1) lookups by ResourceFieldId) */
  fieldMap: Record<ResourceFieldId, ResourceField>

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set resources (rebuilds map and filters custom resources) */
  setResources: (resources: Resource[]) => void

  /** Set loading state */
  setLoading: (isLoading: boolean) => void

  /** Get resource by id or apiSlug (stable reference) */
  getResourceById: (id: string) => Resource | undefined

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
    a.fieldType !== b.fieldType
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

  // Compare enum values (deep)
  if (!deepEqual(a.enumValues, b.enumValues)) {
    return false
  }

  // Compare options
  if (!deepEqual(a.options, b.options)) {
    return false
  }

  return true
}

/**
 * Initial state
 */
const initialState = {
  resources: [],
  customResources: [],
  isLoading: false,
  hasLoadedOnce: false,
  resourceMap: new Map<string, Resource>(),
  fieldMap: {} as Record<ResourceFieldId, ResourceField>,
}

/**
 * Resource store - centralized resource data with selective subscriptions
 */
export const useResourceStore = create<ResourceStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    setResources: (resources) => {
      // Build map for O(1) lookups
      const resourceMap = new Map<string, Resource>()
      resources.forEach((r) => {
        resourceMap.set(r.id, r)
        // Map apiSlug for both system and custom resources
        if (r.apiSlug) {
          resourceMap.set(r.apiSlug, r)
        }
      })

      // Filter custom resources
      const customResources = resources.filter(isCustomResource)

      // Build fieldMap with stable references
      const prevFieldMap = get().fieldMap || {}
      const newFieldMap: Record<ResourceFieldId, ResourceField> = {}

      resources.forEach((resource) => {
        resource.fields.forEach((field) => {
          // Build ResourceFieldId (use existing or compute)
          const resourceFieldId =
            field.resourceFieldId || toResourceFieldId(resource.id, field.id)

          const prevField = prevFieldMap[resourceFieldId]

          // If field hasn't changed, reuse previous reference
          if (prevField && isFieldContentEqual(prevField, field)) {
            newFieldMap[resourceFieldId] = prevField
          } else {
            // New or changed field - create new reference with resourceFieldId
            newFieldMap[resourceFieldId] = {
              ...field,
              resourceFieldId,
            }
          }
        })
      })

      set({ resources, customResources, resourceMap, fieldMap: newFieldMap, hasLoadedOnce: true })
    },

    setLoading: (isLoading) => {
      set({ isLoading })
    },

    getResourceById: (id) => {
      return get().resourceMap.get(id)
    },

    reset: () => {
      set({
        ...initialState,
        resourceMap: new Map<string, Resource>(),
        fieldMap: {} as Record<ResourceFieldId, ResourceField>,
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
