// packages/credentials/src/config/config-cache.ts

/**
 * In-memory cache for config variable DB overrides.
 * Stores resolved values keyed by config variable name.
 */
export class ConfigCache {
  /** Cached DB override values: key → raw value */
  private cache = new Map<string, unknown>()
  /** Whether the cache has been fully loaded at least once */
  private isWarmed = false

  /** Get a cached value. Returns { found: false } if not cached. */
  get(key: string): { value: unknown; found: boolean } {
    if (this.cache.has(key)) {
      return { value: this.cache.get(key), found: true }
    }
    return { value: undefined, found: false }
  }

  /** Whether the cache has been warmed (bulk loaded) */
  get warmed(): boolean {
    return this.isWarmed
  }

  /** Set a value in cache */
  set(key: string, value: unknown): void {
    this.cache.set(key, value)
  }

  /** Remove a key from cache (revert to env/default on next get) */
  markMissing(key: string): void {
    this.cache.delete(key)
  }

  /** Clear all cached data */
  clear(): void {
    this.cache.clear()
    this.isWarmed = false
  }

  /** Bulk load all DB overrides into cache (atomic swap) */
  warmUp(entries: Array<{ key: string; value: unknown }>): void {
    const next = new Map<string, unknown>()
    for (const entry of entries) {
      next.set(entry.key, entry.value)
    }
    this.cache = next
    this.isWarmed = true
  }
}
