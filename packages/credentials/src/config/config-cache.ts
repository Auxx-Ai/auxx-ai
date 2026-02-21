// packages/credentials/src/config/config-cache.ts

/**
 * In-memory cache for config variable DB overrides.
 * Stores resolved values and tracks keys known to have no DB override.
 */
export class ConfigCache {
  /** Cached DB override values: key → raw value */
  private cache = new Map<string, unknown>()
  /** Keys known to have no DB override (avoids repeated DB lookups) */
  private knownMissing = new Set<string>()
  /** Whether the cache has been fully loaded at least once */
  private isWarmed = false

  /** Get a cached value. Returns undefined if not cached. */
  get(key: string): { value: unknown; found: boolean } {
    if (this.cache.has(key)) {
      return { value: this.cache.get(key), found: true }
    }
    return { value: undefined, found: false }
  }

  /** Whether we know this key has no DB override */
  isKnownMissing(key: string): boolean {
    return this.knownMissing.has(key)
  }

  /** Whether the cache has been warmed (bulk loaded) */
  get warmed(): boolean {
    return this.isWarmed
  }

  /** Set a value in cache */
  set(key: string, value: unknown): void {
    this.cache.set(key, value)
    this.knownMissing.delete(key)
  }

  /** Mark a key as having no DB override */
  markMissing(key: string): void {
    this.cache.delete(key)
    this.knownMissing.add(key)
  }

  /** Remove a key from cache (force re-fetch on next get) */
  invalidate(key: string): void {
    this.cache.delete(key)
    this.knownMissing.delete(key)
  }

  /** Clear all cached data */
  clear(): void {
    this.cache.clear()
    this.knownMissing.clear()
    this.isWarmed = false
  }

  /** Bulk load all DB overrides into cache */
  warmUp(entries: Array<{ key: string; value: unknown }>, allKnownKeys: string[]): void {
    this.cache.clear()
    this.knownMissing.clear()

    const dbKeys = new Set<string>()
    for (const entry of entries) {
      this.cache.set(entry.key, entry.value)
      dbKeys.add(entry.key)
    }

    // Mark all known keys that don't have DB overrides as missing
    for (const key of allKnownKeys) {
      if (!dbKeys.has(key)) {
        this.knownMissing.add(key)
      }
    }

    this.isWarmed = true
  }
}
