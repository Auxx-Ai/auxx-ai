// apps/web/src/components/resources/store/resource-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'
import { isCustomResource } from '@auxx/lib/resources/client'

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
 * Initial state
 */
const initialState = {
  resources: [],
  customResources: [],
  isLoading: false,
  hasLoadedOnce: false,
  resourceMap: new Map<string, Resource>(),
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

      set({ resources, customResources, resourceMap, hasLoadedOnce: true })
    },

    setLoading: (isLoading) => {
      set({ isLoading })
    },

    getResourceById: (id) => {
      return get().resourceMap.get(id)
    },

    reset: () => {
      set(initialState)
    },
  }))
)

/**
 * Get resource store state imperatively
 */
export function getResourceStoreState() {
  return useResourceStore.getState()
}
