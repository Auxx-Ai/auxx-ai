// packages/sdk/src/client/hooks/use-async-cache.ts

import { useEffect, useReducer, useRef } from 'react'
import { cacheManager } from './cache-manager.js'
import { generateCacheKey } from './generate-cache-key.js'

/**
 * An async function that returns data
 */
export type AsyncFunction<Input extends Array<any>, Output> = (
  ...args: Input
) => Promise<Output>

/**
 * A type-safe configuration object for multiple async loaders
 *
 * Each key can be:
 * - A function with no parameters: `key: asyncFunction`
 * - A tuple with function and arguments: `key: [asyncFunction, ...args]`
 */
export interface AsyncCacheConfig {
  [K: string]:
    | AsyncFunction<Array<any>, any>
    | [AsyncFunction<Array<any>, any>, ...Array<any>]
}

/**
 * Hook for managing async data loading with caching and suspense support
 *
 * This hook allows multiple async functions to be called in parallel, caches their
 * results, and provides a way to invalidate/refetch specific cache entries.
 *
 * @param config - Configuration object mapping keys to async functions
 * @returns Object containing resolved values and invalidate function
 *
 * @example
 * ```typescript
 * // Simple usage without parameters
 * const { values } = useAsyncCache({
 *   widgets: loadWidgets,
 * })
 *
 * // With parameters
 * const { values, invalidate } = useAsyncCache({
 *   user: [loadUser, userId],
 *   posts: [loadPosts, userId, { limit: 10 }],
 * })
 *
 * // Invalidate and refetch
 * invalidate('user')
 * ```
 */
export function useAsyncCache<Config extends AsyncCacheConfig>(
  config: Config
): {
  values: {
    [K in keyof Config]: Config[K] extends AsyncFunction<any, infer Output>
      ? Output
      : Config[K] extends [
            AsyncFunction<infer Input, infer Output>,
            ...infer Args,
          ]
        ? Args extends Input
          ? Output
          : never
        : never
  }
  invalidate: (name: Extract<keyof Config, string>) => void
} {
  // Force re-render when cache updates
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  // Store cache keys for cleanup and invalidation
  const cacheKeysRef = useRef<Map<string, string>>(new Map())

  // Parse config and generate cache keys for each entry
  const entries = Object.entries(config).map(([name, value]) => {
    let fn: AsyncFunction<any, any>
    let args: any[]

    if (typeof value === 'function') {
      // Format: key: asyncFunction (no parameters)
      fn = value
      args = []
    } else if (Array.isArray(value)) {
      // Format: key: [asyncFunction, ...args]
      ;[fn, ...args] = value
    } else {
      throw new Error(
        `Invalid config for key "${name}": expected function or [function, ...args]`
      )
    }

    const cacheKey = generateCacheKey(name, args)
    cacheKeysRef.current.set(name, cacheKey)

    return { name, fn, args, cacheKey }
  })

  // Subscribe to cache updates for all entries
  useEffect(() => {
    const unsubscribers: Array<() => void> = []

    entries.forEach(({ cacheKey }) => {
      const unsubscribe = cacheManager.subscribe(cacheKey, forceUpdate)
      unsubscribers.push(unsubscribe)
    })

    // Cleanup: unsubscribe from all cache updates
    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [entries.map((e) => e.cacheKey).join(',')])

  // Load data for each entry
  const values: any = {}
  const pendingPromises: Promise<any>[] = []

  for (const { name, fn, args, cacheKey } of entries) {
    let entry = cacheManager.get<any>(cacheKey)

    if (!entry) {
      // Create new cache entry with pending promise
      const promise = fn(...args)
        .then((value) => {
          // Update cache with resolved value
          cacheManager.set(cacheKey, {
            status: 'resolved',
            value,
          })
          return value
        })
        .catch((error) => {
          // Update cache with rejected error
          cacheManager.set(cacheKey, {
            status: 'rejected',
            error,
          })
          throw error
        })

      entry = {
        status: 'pending',
        promise,
      }

      cacheManager.set(cacheKey, entry)
    }

    if (entry.status === 'pending') {
      // Add to pending promises for suspension
      pendingPromises.push(entry.promise!)
    } else if (entry.status === 'resolved') {
      // Use cached value
      values[name] = entry.value
    } else if (entry.status === 'rejected') {
      // Re-throw error to propagate to Error Boundary
      throw entry.error
    }
  }

  // If any promises are pending, suspend the component
  if (pendingPromises.length > 0) {
    throw Promise.all(pendingPromises)
  }

  /**
   * Invalidate a specific cache entry and trigger refetch
   *
   * @param name - The key name to invalidate
   *
   * @example
   * ```typescript
   * invalidate('user') // Clears cache and refetches on next render
   * ```
   */
  const invalidate = (name: Extract<keyof Config, string>) => {
    const cacheKey = cacheKeysRef.current.get(name as string)
    if (cacheKey) {
      cacheManager.delete(cacheKey)
      forceUpdate()
    }
  }

  return { values: values as any, invalidate }
}
