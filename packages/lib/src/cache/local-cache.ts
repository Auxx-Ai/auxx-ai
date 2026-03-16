// packages/lib/src/cache/local-cache.ts

/** Entry stored in the local in-process cache */
export interface LocalCacheEntry<T> {
  value: T
  /** When this entry was written (ms since epoch) */
  writtenAt: number
  /** Hash from Redis — used to detect cross-process invalidation */
  hash: string
}

/**
 * LRU-evicting local cache backed by a Map.
 * Entries are considered stale after `ttlMs` milliseconds.
 * When max capacity is reached, the oldest entries are evicted.
 */
export class LocalCache {
  private cache = new Map<string, LocalCacheEntry<any>>()

  constructor(
    private ttlMs: number = 100,
    private maxEntries: number = 1000
  ) {}

  get<T>(key: string): LocalCacheEntry<T> | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check if entry is stale
    if (Date.now() - entry.writtenAt > this.ttlMs) {
      return undefined // Stale — caller should check Redis hash
    }

    return entry
  }

  set<T>(key: string, value: T, hash: string): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      value,
      writtenAt: Date.now(),
      hash,
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  /** Delete all entries matching a prefix */
  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}
