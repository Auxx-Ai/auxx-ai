// apps/web/src/stores/create-hydration-store.ts

import { useMemo } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

/**
 * Configuration options for creating a hydration store
 */
export interface HydrationStoreOptions<TValue> {
  /** Name for debugging (appears in devtools) */
  name: string

  /**
   * Optional function to extract the key from a value
   * Used when adding items that may have a different key than requested
   * Default: uses the key from the Record directly
   */
  getKeyFromValue?: (value: TValue) => string
}

/**
 * State shape for a hydration store
 */
export interface HydrationStoreState<TValue> {
  /** Hydrated data keyed by identifier */
  dataMap: Record<string, TValue>

  /** Keys that have been requested but not yet fetched */
  pendingIds: Set<string>

  /** Keys currently being fetched */
  loadingIds: Set<string>

  /** Keys that failed to fetch */
  errorIds: Set<string>
}

/**
 * Actions available on a hydration store
 */
export interface HydrationStoreActions<TValue> {
  /** Request hydration for keys - adds to pending if not already hydrated/loading */
  request: (keys: string[]) => void

  /** Mark keys as loading (called when fetch starts) */
  markLoading: (keys: string[]) => void

  /** Add hydrated items to the store. If requestedKeys provided, marks missing keys as not found (null). */
  addItems: (items: Record<string, TValue>, requestedKeys?: string[]) => void

  /** Mark keys as errored */
  markError: (keys: string[]) => void

  /** Get keys that need fetching (pending but not loading) */
  getKeysToFetch: () => string[]

  /** Check if a key is hydrated */
  isHydrated: (key: string) => boolean

  /** Check if a key is loading or pending */
  isLoading: (key: string) => boolean

  /** Get a single item (or undefined) */
  getItem: (key: string) => TValue | undefined

  /** Invalidate specific keys (removes from cache, will refetch on next request) */
  invalidate: (keys: string[]) => void

  /** Invalidate all cached data */
  invalidateAll: () => void

  /** Reset store to initial state */
  reset: () => void
}

/**
 * Combined state and actions for a hydration store
 */
export type HydrationStore<TValue> = HydrationStoreState<TValue> &
  HydrationStoreActions<TValue>

/**
 * Initial state factory
 */
function createInitialState<TValue>(): HydrationStoreState<TValue> {
  return {
    dataMap: {},
    pendingIds: new Set(),
    loadingIds: new Set(),
    errorIds: new Set(),
  }
}

/**
 * Creates a Zustand store for on-demand data hydration with selector-based subscriptions
 *
 * @example
 * ```typescript
 * // Create a store for relationship items
 * const useRelationshipStore = createHydrationStore<ResourcePickerItem>({
 *   name: 'relationship',
 *   getKeyFromValue: (item) => `${item.entityDefinitionId}:${item.id}`,
 * })
 *
 * // Create a store for resource fields
 * const useResourceFieldStore = createHydrationStore<ResourceField[]>({
 *   name: 'resource-fields',
 * })
 * ```
 */
export function createHydrationStore<TValue>(
  options: HydrationStoreOptions<TValue>
) {
  const initialState = createInitialState<TValue>()

  const store = create<HydrationStore<TValue>>()(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      request: (keys) => {
        // Guard: ensure keys is an array (string would iterate characters)
        if (!Array.isArray(keys)) {
          console.error('[HydrationStore] request() called with non-array:', typeof keys, keys)
          return
        }

        set((state) => {
          const newPending = new Set(state.pendingIds)
          let hasNewKeys = false

          for (const key of keys) {
            // Skip if already hydrated, loading, or pending
            if (
              state.dataMap[key] !== undefined ||
              state.loadingIds.has(key) ||
              state.pendingIds.has(key)
            ) {
              continue
            }

            newPending.add(key)
            hasNewKeys = true
          }

          if (!hasNewKeys) return state
          return { pendingIds: newPending }
        })
      },

      markLoading: (keys) => {
        set((state) => {
          const newPending = new Set(state.pendingIds)
          const newLoading = new Set(state.loadingIds)

          for (const key of keys) {
            newPending.delete(key)
            newLoading.add(key)
          }

          return { pendingIds: newPending, loadingIds: newLoading }
        })
      },

      addItems: (items, requestedKeys) => {
        set((state) => {
          const newLoading = new Set(state.loadingIds)
          const newDataMap = { ...state.dataMap }

          // Add found items
          for (const [key, value] of Object.entries(items)) {
            // If getKeyFromValue is provided, use it to determine the actual key
            const actualKey = options.getKeyFromValue
              ? options.getKeyFromValue(value)
              : key

            newLoading.delete(key)
            newLoading.delete(actualKey)
            newDataMap[actualKey] = value
          }

          // Mark missing items as not found (null sentinel)
          if (requestedKeys) {
            for (const key of requestedKeys) {
              if (!(key in newDataMap)) {
                newLoading.delete(key)
                newDataMap[key] = null as unknown as TValue
              }
            }
          }

          return { loadingIds: newLoading, dataMap: newDataMap }
        })
      },

      markError: (keys) => {
        set((state) => {
          const newLoading = new Set(state.loadingIds)
          const newError = new Set(state.errorIds)

          for (const key of keys) {
            newLoading.delete(key)
            newError.add(key)
          }

          return { loadingIds: newLoading, errorIds: newError }
        })
      },

      getKeysToFetch: () => {
        return Array.from(get().pendingIds)
      },

      isHydrated: (key) => {
        return key in get().dataMap
      },

      isLoading: (key) => {
        const state = get()
        return state.loadingIds.has(key) || state.pendingIds.has(key)
      },

      getItem: (key) => {
        return get().dataMap[key]
      },

      invalidate: (keys) => {
        set((state) => {
          const newDataMap = { ...state.dataMap }
          const newErrorIds = new Set(state.errorIds)

          for (const key of keys) {
            delete newDataMap[key]
            newErrorIds.delete(key)
          }

          return { dataMap: newDataMap, errorIds: newErrorIds }
        })
      },

      invalidateAll: () => {
        set(() => ({
          dataMap: {},
          errorIds: new Set(),
          // Keep pending/loading as-is to not interrupt in-flight fetches
        }))
      },

      reset: () => {
        set(createInitialState())
      },
    }))
  )

  return store
}

/**
 * Creates selector hooks for a hydration store
 * Returns hooks that only re-render when specific items change
 */
export function createHydrationHooks<TValue>(
  useStore: ReturnType<typeof createHydrationStore<TValue>>
) {
  /**
   * Get a single item by key
   * Only re-renders when this specific item changes
   */
  function useItem(key: string | undefined): TValue | undefined {
    return useStore((state) => (key ? state.dataMap[key] : undefined))
  }

  /**
   * Get multiple items by keys
   * Only re-renders when any of these specific items change
   */
  function useItems(keys: string[]): (TValue | undefined)[] {
    const dataMap = useStore((state) => state.dataMap)

    return useMemo(() => keys.map((key) => dataMap[key]), [keys, dataMap])
  }

  /**
   * Check if a specific key is loading or pending
   */
  function useIsLoading(key: string | undefined): boolean {
    return useStore((state) =>
      key ? state.loadingIds.has(key) || state.pendingIds.has(key) : false
    )
  }

  /**
   * Check if any of the keys are loading or pending
   */
  function useIsLoadingAny(keys: string[]): boolean {
    return useStore((state) =>
      keys.some((key) => state.loadingIds.has(key) || state.pendingIds.has(key))
    )
  }

  /**
   * Check if a key has errored
   */
  function useHasError(key: string | undefined): boolean {
    return useStore((state) => (key ? state.errorIds.has(key) : false))
  }

  /**
   * Get pending count (useful for loading indicators)
   */
  function usePendingCount(): number {
    return useStore((state) => state.pendingIds.size)
  }

  return {
    useItem,
    useItems,
    useIsLoading,
    useIsLoadingAny,
    useHasError,
    usePendingCount,
  }
}

/**
 * Convenience function that creates both store and hooks
 */
export function createHydrationStoreWithHooks<TValue>(
  options: HydrationStoreOptions<TValue>
) {
  const useStore = createHydrationStore<TValue>(options)
  const hooks = createHydrationHooks(useStore)

  return {
    useStore,
    ...hooks,
  }
}
