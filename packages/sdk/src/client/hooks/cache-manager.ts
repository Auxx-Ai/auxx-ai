// packages/sdk/src/client/hooks/cache-manager.ts

/**
 * Represents an entry in the async cache
 */
type CacheEntry<T> = {
  /** Current status of the cache entry */
  status: 'pending' | 'resolved' | 'rejected'
  /** Resolved value (only present when status is 'resolved') */
  value?: T
  /** Error object (only present when status is 'rejected') */
  error?: Error
  /** Promise for pending operations */
  promise?: Promise<T>
}

/**
 * Global cache manager for async operations
 * Stores cache entries and notifies listeners of changes
 */
class CacheManager {
  /** Internal cache storage */
  private cache = new Map<string, CacheEntry<any>>()

  /** Listeners for cache updates by key */
  private listeners = new Map<string, Set<() => void>>()

  /**
   * Get a cache entry by key
   * @param key - The cache key
   * @returns The cache entry or undefined if not found
   */
  get<T>(key: string): CacheEntry<T> | undefined {
    return this.cache.get(key)
  }

  /**
   * Set a cache entry and notify listeners
   * @param key - The cache key
   * @param entry - The cache entry to store
   */
  set<T>(key: string, entry: CacheEntry<T>): void {
    this.cache.set(key, entry)
    this.notifyListeners(key)
  }

  /**
   * Delete a cache entry and notify listeners
   * @param key - The cache key to delete
   */
  delete(key: string): void {
    this.cache.delete(key)
    this.notifyListeners(key)
  }

  /**
   * Subscribe to changes for a specific cache key
   * @param key - The cache key to listen to
   * @param listener - Callback function to execute on changes
   * @returns Unsubscribe function
   */
  subscribe(key: string, listener: () => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(listener)

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(listener)
    }
  }

  /**
   * Notify all listeners for a specific cache key
   * @param key - The cache key whose listeners should be notified
   */
  private notifyListeners(key: string): void {
    const listeners = this.listeners.get(key)
    if (listeners) {
      listeners.forEach((listener) => listener())
    }
  }
}

/**
 * Global singleton cache manager instance
 */
export const cacheManager = new CacheManager()
