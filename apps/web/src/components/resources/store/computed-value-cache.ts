// apps/web/src/components/resources/store/computed-value-cache.ts

import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'

type ComputedValueKey = `${RecordId}:${ResourceFieldId}`

/**
 * Cached computed value with metadata for invalidation.
 */
interface CachedValue {
  value: unknown
  /** Keys of source field values used to compute this value */
  sourceKeys: string[]
  /** Timestamp for LRU eviction */
  accessedAt: number
}

/**
 * Cache for computed field values.
 * Automatically invalidates when source values change.
 * Uses LRU eviction when cache exceeds maxSize.
 */
class ComputedValueCache {
  private cache = new Map<ComputedValueKey, CachedValue>()
  private maxSize = 1000

  /**
   * Build cache key from recordId and fieldId.
   */
  private buildKey(recordId: RecordId, fieldId: ResourceFieldId): ComputedValueKey {
    return `${recordId}:${fieldId}` as ComputedValueKey
  }

  /**
   * Get cached computed value.
   * Returns undefined if not cached.
   */
  get(recordId: RecordId, fieldId: ResourceFieldId): unknown | undefined {
    const key = this.buildKey(recordId, fieldId)
    const cached = this.cache.get(key)

    if (cached) {
      cached.accessedAt = Date.now()
      return cached.value
    }

    return undefined
  }

  /**
   * Check if a computed value is cached.
   */
  has(recordId: RecordId, fieldId: ResourceFieldId): boolean {
    const key = this.buildKey(recordId, fieldId)
    return this.cache.has(key)
  }

  /**
   * Store computed value with source dependencies.
   */
  set(recordId: RecordId, fieldId: ResourceFieldId, value: unknown, sourceKeys: string[]): void {
    const key = this.buildKey(recordId, fieldId)

    this.cache.set(key, {
      value,
      sourceKeys,
      accessedAt: Date.now(),
    })

    // LRU eviction if cache is too large
    if (this.cache.size > this.maxSize) {
      this.evictOldest()
    }
  }

  /**
   * Invalidate all computed values that depend on the given source key.
   */
  invalidateBySourceKey(sourceKey: string): void {
    for (const [cacheKey, cached] of this.cache.entries()) {
      if (cached.sourceKeys.includes(sourceKey)) {
        this.cache.delete(cacheKey)
      }
    }
  }

  /**
   * Invalidate all computed values for a specific record.
   */
  invalidateByRecord(recordId: RecordId): void {
    const prefix = `${recordId}:`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Invalidate a specific computed value.
   */
  invalidate(recordId: RecordId, fieldId: ResourceFieldId): void {
    const key = this.buildKey(recordId, fieldId)
    this.cache.delete(key)
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache size (for debugging/monitoring).
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Evict oldest entries (LRU).
   * Removes oldest 10% of entries.
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries())
    entries.sort((a, b) => a[1].accessedAt - b[1].accessedAt)

    // Remove oldest 10%
    const toRemove = Math.ceil(entries.length * 0.1)
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0])
    }
  }
}

/** Singleton cache instance */
export const computedValueCache = new ComputedValueCache()
