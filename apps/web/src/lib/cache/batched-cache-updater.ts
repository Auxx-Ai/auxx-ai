// apps/web/src/lib/cache/batched-cache-updater.ts

import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Update function type for cache updates
 */
type CacheUpdateFunction = (data: any) => any

/**
 * Batches cache updates to prevent excessive re-renders and improve performance
 * All updates scheduled within the same frame are batched together
 */
export class BatchedCacheUpdater {
  private pendingUpdates: Map<string, CacheUpdateFunction[]> = new Map()
  private flushTimeout?: NodeJS.Timeout

  constructor(private queryClient: QueryClient) {}

  /**
   * Schedule a cache update to be executed in the next batch
   * @param queryKey The query key to update
   * @param updateFn Function that transforms the cache data
   */
  scheduleUpdate(queryKey: QueryKey, updateFn: CacheUpdateFunction): void {
    const queryKeyString = this.serializeQueryKey(queryKey)

    if (!this.pendingUpdates.has(queryKeyString)) {
      this.pendingUpdates.set(queryKeyString, [])
    }

    this.pendingUpdates.get(queryKeyString)!.push(updateFn)

    // Debounce flush to next frame for optimal performance
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }

    this.flushTimeout = setTimeout(() => this.flush(), 16) // ~60fps
  }

  /**
   * Force immediate flush of all pending updates
   * Usually not needed as updates are automatically flushed
   */
  flushImmediate(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = undefined
    }

    this.flush()
  }

  /**
   * Get the number of pending updates
   * Useful for debugging and testing
   */
  getPendingCount(): number {
    let total = 0
    this.pendingUpdates.forEach((updates) => {
      total += updates.length
    })
    return total
  }

  /**
   * Clear all pending updates without executing them
   * Useful for testing or error recovery
   */
  clear(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = undefined
    }

    this.pendingUpdates.clear()
  }

  /**
   * Execute all pending cache updates in a single batch
   * This minimizes React re-renders and improves performance
   */
  private flush(): void {
    if (this.pendingUpdates.size === 0) {
      return
    }

    // Process all pending updates
    this.pendingUpdates.forEach((updateFunctions, queryKeyString) => {
      const queryKey = this.deserializeQueryKey(queryKeyString)

      try {
        // Apply all update functions in sequence to the same query
        this.queryClient.setQueryData(queryKey, (oldData: any) => {
          return updateFunctions.reduce((data, updateFn) => {
            try {
              return updateFn(data)
            } catch (error) {
              console.error('Error applying cache update:', error)
              return data // Return unchanged data on error
            }
          }, oldData)
        })
      } catch (error) {
        console.error('Error updating query cache:', error, { queryKey })
      }
    })

    // Clear pending updates
    this.pendingUpdates.clear()
    this.flushTimeout = undefined
  }

  /**
   * Serialize a query key to a string for storage in Map
   * @param queryKey The query key to serialize
   * @returns Serialized string representation
   */
  private serializeQueryKey(queryKey: QueryKey): string {
    return JSON.stringify(queryKey)
  }

  /**
   * Deserialize a query key string back to a QueryKey
   * @param queryKeyString The serialized query key
   * @returns The original QueryKey
   */
  private deserializeQueryKey(queryKeyString: string): QueryKey {
    return JSON.parse(queryKeyString)
  }
}
