// packages/lib/src/cache/base-cache-service.ts

import { getRedisClient, type RedisClient } from '@auxx/redis'
import { createScopedLogger } from '../logger'

const logger = createScopedLogger('BaseCache', { color: 'green' })

/**
 * Options for cache operations
 * @interface CacheOptions
 */
export interface CacheOptions {
  /** Time to live in seconds. Defaults to service's defaultTtl */
  ttl?: number
  /** Skip cache and force fresh data retrieval */
  skipCache?: boolean
  /** Tags for cache invalidation grouping */
  tags?: string[]
}

/**
 * Internal cache entry structure
 * @interface CacheEntry
 * @template T - The type of the cached value
 */
export interface CacheEntry<T> {
  /** The cached value */
  value: T
  /** Expiration timestamp in milliseconds */
  expires: number
  /** Tags for cache invalidation */
  tags: string[]
  /** Creation timestamp in milliseconds */
  createdAt: number
}

/**
 * Base cache service that provides a dual-layer caching system with Redis and in-memory fallback.
 * Designed to be extended by specialized cache services for different domains.
 *
 * Features:
 * - Automatic Redis connection with in-memory fallback
 * - TTL-based expiration
 * - Tag-based invalidation (using Redis Sets for reliable cross-instance invalidation)
 * - Pattern-based invalidation (using Redis SCAN)
 * - Graceful error handling
 * - Debug logging in development mode (NODE_ENV=development)
 */
export class BaseCacheService {
  /** In-memory cache as fallback when Redis is unavailable */
  private memoryCache = new Map<string, CacheEntry<any>>()
  /** Redis client instance, undefined if unavailable */
  private redisClient: RedisClient | undefined = undefined
  /** Promise that resolves when Redis initialization is complete */
  private redisReady: Promise<void>
  /** Flag indicating if Redis is available for use */
  private useRedis = true
  /** Flag indicating if we're in development mode for debug logging */
  private isDevelopment = process.env.NODE_ENV === 'development'

  /**
   * Creates a new BaseCacheService instance
   *
   * @param keyPrefix - Prefix for all cache keys to avoid collisions
   * @param defaultTtl - Default time to live in seconds (default: 900 = 15 minutes)
   */
  constructor(
    private keyPrefix: string = '',
    private defaultTtl: number = 900 // 15 minutes
  ) {
    this.redisReady = this.initializeRedis()
  }

  /**
   * Initializes Redis connection with graceful fallback to in-memory cache
   * Called automatically during construction
   */
  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = await getRedisClient(false) // Optional connection
    } catch (error) {
      logger.warn('Redis unavailable, using in-memory cache', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.useRedis = false
    }
  }

  /**
   * Ensures Redis is ready before performing operations
   * Awaits the initialization promise and returns the client if available
   */
  private async ensureRedisReady(): Promise<RedisClient | undefined> {
    await this.redisReady
    return this.redisClient
  }

  /**
   * Generates the Redis key for a tag set
   * Tag sets store all cache keys that have a specific tag
   */
  private getTagSetKey(tag: string): string {
    return `${this.keyPrefix}:_tags:${tag}`
  }

  /**
   * Retrieves a value from the cache by key
   * Tries Redis first, then falls back to in-memory cache
   * Automatically cleans up expired entries
   *
   * @template T - The expected type of the cached value
   * @param key - The cache key (without prefix)
   * @returns Promise resolving to the cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key)

    if (this.isDevelopment) {
      logger.debug('Cache get attempt', { key: fullKey })
    }

    try {
      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      // Try Redis first if available
      if (this.useRedis && client) {
        const data = await client.get(fullKey)
        if (data) {
          try {
            const entry: CacheEntry<T> = JSON.parse(data)
            if (entry.expires > Date.now()) {
              if (this.isDevelopment) {
                logger.debug(`Cache hit (Redis):[${fullKey}]`, {
                  ttlRemaining: Math.round((entry.expires - Date.now()) / 1000),
                  tags: entry.tags,
                })
              }
              return entry.value
            } else {
              if (this.isDevelopment) {
                logger.debug(`Cache expired (Redis):[${fullKey}]`)
              }
              // Expired, clean up
              this.delete(key).catch(() => {})
              return null
            }
          } catch (error) {
            logger.warn(`Failed to parse Redis cache entry:[${fullKey}]`, { error })
            return null
          }
        }
      }

      // Fallback to memory cache
      const entry = this.memoryCache.get(fullKey)
      if (entry && entry.expires > Date.now()) {
        if (this.isDevelopment) {
          logger.debug(`Cache hit (Memory):[${fullKey}]`, {
            ttlRemaining: Math.round((entry.expires - Date.now()) / 1000),
            tags: entry.tags,
          })
        }
        return entry.value
      } else if (entry) {
        if (this.isDevelopment) {
          logger.debug(`Cache expired (Memory):[${fullKey}]`)
        }
        // Expired, clean up
        this.memoryCache.delete(fullKey)
      }

      if (this.isDevelopment) {
        logger.debug(`Cache miss:[${fullKey}]`)
      }
      return null
    } catch (error) {
      logger.error(`Cache get error:[${fullKey}]`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Stores a value in the cache with optional TTL and tags
   * Stores in both Redis and in-memory cache for redundancy
   * Registers keys with tag sets in Redis for reliable tag-based invalidation
   *
   * @template T - The type of the value to cache
   * @param key - The cache key (without prefix)
   * @param value - The value to cache
   * @param options - Cache options including TTL and tags
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl ?? this.defaultTtl
    const fullKey = this.getFullKey(key)
    const expires = Date.now() + ttl * 1000
    const tags = options.tags || []

    if (this.isDevelopment) {
      logger.debug(`Cache set:[${fullKey}]`, {
        ttl,
        tags,
        valueSize: JSON.stringify(value).length,
      })
    }

    const entry: CacheEntry<T> = {
      value,
      expires,
      tags,
      createdAt: Date.now(),
    }

    try {
      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      // Store in Redis if available
      if (this.useRedis && client) {
        await client.setex(fullKey, ttl, JSON.stringify(entry))

        // Register this key with each tag set for reliable tag-based invalidation
        // Use same TTL for tag sets so they auto-expire with the entries
        for (const tag of tags) {
          const tagSetKey = this.getTagSetKey(tag)
          const added = await client.sadd(tagSetKey, fullKey)
          await client.expire(tagSetKey, ttl)
          logger.debug(`Tag set updated:[${tagSetKey}]`, { key: fullKey, added, ttl })
        }

        if (this.isDevelopment) {
          logger.debug(`Cache stored in Redis:[${fullKey}]`, { tags })
        }
      }

      // Always store in memory as fallback
      this.memoryCache.set(fullKey, entry)
      if (this.isDevelopment) {
        logger.debug('Cache stored in memory', {
          key: fullKey,
          memorySize: this.memoryCache.size,
        })
      }
    } catch (error) {
      logger.error('Cache set error', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error),
      })
      // Still store in memory on Redis failure
      this.memoryCache.set(fullKey, entry)
    }
  }

  /**
   * Deletes a specific cache entry by key
   * Removes from both Redis and in-memory cache
   * Also removes the key from any tag sets it belongs to
   *
   * @param key - The cache key to delete (without prefix)
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key)

    if (this.isDevelopment) {
      logger.debug(`Cache delete:[${fullKey}]`)
    }

    try {
      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      if (this.useRedis && client) {
        // Get the entry first to find its tags
        const data = await client.get(fullKey)
        if (data) {
          try {
            const entry: CacheEntry<unknown> = JSON.parse(data)
            // Remove this key from all its tag sets
            for (const tag of entry.tags) {
              const tagSetKey = this.getTagSetKey(tag)
              await client.srem(tagSetKey, fullKey)
            }
          } catch {
            // Ignore parse errors, just delete the key
          }
        }

        await client.del(fullKey)
        if (this.isDevelopment) {
          logger.debug(`Cache deleted from Redis:[${fullKey}]`)
        }
      }

      // Also get tags from memory entry for cleanup
      const memEntry = this.memoryCache.get(fullKey)
      this.memoryCache.delete(fullKey)

      if (this.isDevelopment) {
        logger.debug(`Cache deleted from memory:[${fullKey}]`, {
          key: fullKey,
          memorySize: this.memoryCache.size,
          hadTags: memEntry?.tags?.length ?? 0,
        })
      }
    } catch (error) {
      logger.error(`Cache delete error:[${fullKey}]`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Invalidates all cache entries that contain the specified tag
   * Uses Redis Sets for reliable cross-instance invalidation
   *
   * @param tag - The tag to invalidate
   */
  async invalidateByTag(tag: string): Promise<void> {
    if (this.isDevelopment) {
      logger.debug('Cache invalidate by tag', { tag })
    }

    try {
      let invalidatedCount = 0

      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      // Handle Redis tag-based invalidation using Sets
      if (this.useRedis && client) {
        const tagSetKey = this.getTagSetKey(tag)
        logger.debug(`Looking up tag set:[${tagSetKey}]`)

        // Get all keys with this tag from the Redis Set
        const keys = await client.smembers(tagSetKey)
        logger.debug(`Tag set members:[${tagSetKey}]`, { keys, count: keys?.length ?? 0 })

        if (keys && keys.length > 0) {
          // Delete all the cache entries
          await client.del(...keys)
          invalidatedCount = keys.length
          logger.debug(`Deleted ${keys.length} Redis keys for tag:[${tag}]`, { keys })
        }

        // Delete the tag set itself
        await client.del(tagSetKey)
      } else {
        logger.warn(`Redis not available for tag invalidation:[${tag}]`, {
          useRedis: this.useRedis,
          hasClient: !!client,
        })
      }

      // Also clean memory cache entries with this tag
      for (const [key, entry] of this.memoryCache.entries()) {
        if (entry.tags.includes(tag)) {
          this.memoryCache.delete(key)
        }
      }

      if (this.isDevelopment) {
        logger.debug('Tag invalidation completed', {
          tag,
          invalidatedCount,
          memorySize: this.memoryCache.size,
        })
      }
    } catch (error) {
      logger.error(`Cache invalidate by tag error:[${tag}]`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Invalidates all cache entries whose keys match the specified pattern
   * Uses Redis SCAN for reliable cross-instance invalidation
   *
   * @param pattern - Regular expression pattern to match against full cache keys (including prefix)
   */
  async invalidateByPattern(pattern: RegExp): Promise<void> {
    if (this.isDevelopment) {
      logger.debug('Cache invalidate by pattern', { pattern: pattern.source })
    }

    try {
      let invalidatedCount = 0

      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      // Handle Redis pattern-based invalidation using SCAN
      if (this.useRedis && client) {
        const redisPattern = `${this.keyPrefix}:*`
        let cursor = '0'

        do {
          // SCAN is non-blocking and iterates through keys
          const result = await client.scan(cursor, 'MATCH', redisPattern, 'COUNT', 100)
          cursor = result[0]
          const keys = result[1]

          // Filter keys that match the RegExp pattern
          const keysToDelete = keys.filter((key: string) => pattern.test(key))

          if (keysToDelete.length > 0) {
            // Also remove from tag sets before deleting
            for (const key of keysToDelete) {
              const data = await client.get(key)
              if (data) {
                try {
                  const entry: CacheEntry<unknown> = JSON.parse(data)
                  for (const tag of entry.tags) {
                    const tagSetKey = this.getTagSetKey(tag)
                    await client.srem(tagSetKey, key)
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }

            await client.del(...keysToDelete)
            invalidatedCount += keysToDelete.length

            if (this.isDevelopment) {
              logger.debug(`Deleted ${keysToDelete.length} Redis keys matching pattern`, {
                pattern: pattern.source,
                keys: keysToDelete,
              })
            }
          }
        } while (cursor !== '0')
      }

      // Also clean memory cache
      for (const key of this.memoryCache.keys()) {
        if (pattern.test(key)) {
          this.memoryCache.delete(key)
        }
      }

      if (this.isDevelopment) {
        logger.debug('Pattern invalidation completed', {
          pattern: pattern.source,
          invalidatedCount,
          memorySize: this.memoryCache.size,
        })
      }
    } catch (error) {
      logger.error('Cache invalidate by pattern error', {
        pattern: pattern.source,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Clears all cache entries for this service instance
   * Removes all entries from both in-memory cache and Redis (matching the key prefix)
   * Uses SCAN for non-blocking iteration
   */
  async clear(): Promise<void> {
    if (this.isDevelopment) {
      logger.debug(`Cache clear all:[${this.keyPrefix}]`)
    }

    try {
      const memorySize = this.memoryCache.size
      this.memoryCache.clear()

      // Ensure Redis is ready before attempting to use it
      const client = await this.ensureRedisReady()

      let redisKeysCleared = 0
      if (this.useRedis && client) {
        // Use SCAN instead of KEYS for non-blocking iteration
        const pattern = `${this.keyPrefix}:*`
        let cursor = '0'

        do {
          const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
          cursor = result[0]
          const keys = result[1]

          if (keys.length > 0) {
            await client.del(...keys)
            redisKeysCleared += keys.length
          }
        } while (cursor !== '0')
      }

      if (this.isDevelopment) {
        logger.debug('Cache cleared', {
          keyPrefix: this.keyPrefix,
          memoryKeysCleared: memorySize,
          redisKeysCleared,
        })
      }
    } catch (error) {
      logger.error('Cache clear error', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Generates the full cache key by combining prefix with the provided key
   */
  private getFullKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key
  }

  /**
   * Utility method for building hierarchical cache keys from multiple parts
   * Filters out empty/falsy parts and joins with colons
   */
  protected buildKey(...parts: string[]): string {
    return parts.filter(Boolean).join(':')
  }
}
