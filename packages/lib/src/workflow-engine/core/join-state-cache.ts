// packages/lib/src/workflow-engine/core/join-state-cache.ts

import { createScopedLogger } from '@auxx/logger'
import type { JoinState } from './types'

const logger = createScopedLogger('join-state-cache')

/**
 * Simple LRU Cache implementation for join states
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

/**
 * Cache for join states to reduce database lookups
 */
export class JoinStateCache {
  private cache = new LRUCache<string, JoinState>(1000)
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
  }

  /**
   * Get join state from cache
   */
  get(executionId: string, joinNodeId: string): JoinState | undefined {
    const key = this.generateKey(executionId, joinNodeId)
    const cached = this.cache.get(key)

    if (cached) {
      this.stats.hits++
      logger.debug('Cache hit', { key, hits: this.stats.hits })
    } else {
      this.stats.misses++
      logger.debug('Cache miss', { key, misses: this.stats.misses })
    }

    return cached
  }

  /**
   * Set join state in cache
   */
  set(executionId: string, joinNodeId: string, state: JoinState): void {
    const key = this.generateKey(executionId, joinNodeId)
    this.cache.set(key, state)
    this.stats.sets++
    logger.debug('Cache set', { key, sets: this.stats.sets })
  }

  /**
   * Invalidate cached join state
   */
  invalidate(executionId: string, joinNodeId: string): void {
    const key = this.generateKey(executionId, joinNodeId)
    if (this.cache.delete(key)) {
      this.stats.deletes++
      logger.debug('Cache invalidated', { key, deletes: this.stats.deletes })
    }
  }

  /**
   * Clear all cached states
   */
  clear(): void {
    this.cache.clear()
    logger.info('Cache cleared', { previousSize: this.cache.size })
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0

    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: `${hitRate.toFixed(2)}%`,
    }
  }

  /**
   * Generate cache key
   */
  private generateKey(executionId: string, joinNodeId: string): string {
    return `${executionId}:${joinNodeId}`
  }
}

// Singleton instance
export const joinStateCache = new JoinStateCache()
