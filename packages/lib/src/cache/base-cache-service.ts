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
 * - Tag-based invalidation
 * - Pattern-based invalidation
 * - Graceful error handling
 * - Debug logging in development mode (NODE_ENV=development)
 *
 * @example
 * ```typescript
 * // Basic usage
 * const cache = new BaseCacheService('user:', 3600); // 1 hour default TTL
 *
 * // Store data
 * await cache.set('profile:123', { name: 'John', email: 'john@example.com' });
 *
 * // Retrieve data
 * const profile = await cache.get<UserProfile>('profile:123');
 *
 * // Store with custom TTL and tags
 * await cache.set('temp:data', { value: 42 }, {
 *   ttl: 300, // 5 minutes
 *   tags: ['temp', 'calculations']
 * });
 *
 * // Invalidate by tag
 * await cache.invalidateByTag('temp');
 * ```
 *
 * @example
 * ```typescript
 * // Extending for specific use cases
 * class UserCacheService extends BaseCacheService {
 *   constructor() {
 *     super('user:', 1800); // 30 minutes
 *   }
 *
 *   async cacheUserProfile(userId: string, profile: UserProfile) {
 *     const key = this.buildKey('profile', userId);
 *     await this.set(key, profile, { tags: ['user', 'profile'] });
 *   }
 *
 *   async getUserProfile(userId: string): Promise<UserProfile | null> {
 *     const key = this.buildKey('profile', userId);
 *     return this.get<UserProfile>(key);
 *   }
 * }
 * ```
 */
export class BaseCacheService {
  /** In-memory cache as fallback when Redis is unavailable */
  private memoryCache = new Map<string, CacheEntry<any>>()
  /** Redis client instance, null if unavailable */
  private redisClient: RedisClient | undefined = undefined
  /** Flag indicating if Redis is available for use */
  private useRedis = true
  /** Flag indicating if we're in development mode for debug logging */
  private isDevelopment = process.env.NODE_ENV === 'development'

  /**
   * Creates a new BaseCacheService instance
   *
   * @param keyPrefix - Prefix for all cache keys to avoid collisions
   * @param defaultTtl - Default time to live in seconds (default: 900 = 15 minutes)
   *
   * @example
   * ```typescript
   * const userCache = new BaseCacheService('user:', 3600);
   * const sessionCache = new BaseCacheService('session:', 1800);
   * ```
   */
  constructor(
    private keyPrefix: string = '',
    private defaultTtl: number = 900 // 15 minutes
  ) {
    this.initializeRedis()
  }

  /**
   * Initializes Redis connection with graceful fallback to in-memory cache
   * Called automatically during construction
   *
   * @private
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
   * Retrieves a value from the cache by key
   * Tries Redis first, then falls back to in-memory cache
   * Automatically cleans up expired entries
   *
   * @template T - The expected type of the cached value
   * @param key - The cache key (without prefix)
   * @returns Promise resolving to the cached value or null if not found/expired
   *
   * @example
   * ```typescript
   * // Get user profile
   * const profile = await cache.get<UserProfile>('profile:123');
   * if (profile) {
   *   console.log(`User: ${profile.name}`);
   * }
   *
   * // Get with type safety
   * interface ApiResponse { data: string[], total: number }
   * const response = await cache.get<ApiResponse>('api:users');
   * ```
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key)

    if (this.isDevelopment) {
      logger.debug('Cache get attempt', { key: fullKey })
    }

    try {
      // Try Redis first if available
      if (this.useRedis && this.redisClient) {
        const data = await this.redisClient.get(fullKey)
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
   *
   * @template T - The type of the value to cache
   * @param key - The cache key (without prefix)
   * @param value - The value to cache
   * @param options - Cache options including TTL and tags
   *
   * @example
   * ```typescript
   * // Simple caching with default TTL
   * await cache.set('user:123', { name: 'John', email: 'john@example.com' });
   *
   * // Cache with custom TTL (5 minutes)
   * await cache.set('temp:data', calculations, { ttl: 300 });
   *
   * // Cache with tags for bulk invalidation
   * await cache.set('product:456', productData, {
   *   ttl: 3600,
   *   tags: ['product', 'catalog', 'user:123']
   * });
   *
   * // Cache API response with short TTL
   * await cache.set('api:weather', weatherData, {
   *   ttl: 600, // 10 minutes
   *   tags: ['external-api', 'weather']
   * });
   * ```
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
      // Store in Redis if available
      if (this.useRedis && this.redisClient) {
        await this.redisClient.setex(fullKey, ttl, JSON.stringify(entry))
        if (this.isDevelopment) {
          logger.debug(`Cache stored in Redis:[${fullKey}]`)
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
   *
   * @param key - The cache key to delete (without prefix)
   *
   * @example
   * ```typescript
   * // Delete specific user data
   * await cache.delete('user:123');
   *
   * // Delete temporary calculation
   * await cache.delete('temp:calculation:abc');
   * ```
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key)

    if (this.isDevelopment) {
      logger.debug(`Cache delete:[${fullKey}]`)
    }

    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.del(fullKey)
        if (this.isDevelopment) {
          logger.debug(`Cache deleted from Redis:[${fullKey}]`)
        }
      }
      this.memoryCache.delete(fullKey)
      if (this.isDevelopment) {
        logger.debug(`Cache deleted from memory:[${fullKey}]`, {
          key: fullKey,
          memorySize: this.memoryCache.size,
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
   * Note: Only works reliably for in-memory cache entries.
   * For Redis, only entries also present in memory will be invalidated.
   *
   * @param tag - The tag to invalidate
   *
   * @example
   * ```typescript
   * // Invalidate all user-related cache entries
   * await cache.invalidateByTag('user');
   *
   * // Invalidate all product catalog entries
   * await cache.invalidateByTag('catalog');
   *
   * // Invalidate entries for specific user
   * await cache.invalidateByTag('user:123');
   * ```
   */
  async invalidateByTag(tag: string): Promise<void> {
    if (this.isDevelopment) {
      logger.debug('Cache invalidate by tag', { tag })
    }

    try {
      let invalidatedCount = 0
      // Handle in-memory cache entries
      for (const [key, entry] of this.memoryCache.entries()) {
        if (entry.tags.includes(tag)) {
          this.memoryCache.delete(key)
          invalidatedCount++
          // Also delete from Redis
          if (this.useRedis && this.redisClient) {
            this.redisClient.del(key).catch(() => {})
          }
        }
      }

      if (this.isDevelopment) {
        logger.debug('Tag invalidation completed', {
          tag,
          invalidatedCount,
          memorySize: this.memoryCache.size,
        })
      }

      // Note: For Redis, tag-based invalidation is limited to in-memory entries.
      // Services should use explicit key deletion for reliable Redis invalidation.
      logger.debug(`Tag invalidation completed for in-memory cache:[${tag}]`)
    } catch (error) {
      logger.error(`Cache invalidate by tag error:[${tag}]`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Invalidates all cache entries whose keys match the specified pattern
   * Note: Only works reliably for in-memory cache entries.
   * For Redis, only entries also present in memory will be invalidated.
   *
   * @param pattern - Regular expression pattern to match against full cache keys (including prefix)
   *
   * @example
   * ```typescript
   * // Invalidate all user profile entries
   * await cache.invalidateByPattern(/user:profile:/);
   *
   * // Invalidate all temporary entries
   * await cache.invalidateByPattern(/temp:/);
   *
   * // Invalidate entries for specific user
   * await cache.invalidateByPattern(/user:123:/);
   *
   * // Invalidate all API cache entries
   * await cache.invalidateByPattern(/api:./);
   * ```
   */
  async invalidateByPattern(pattern: RegExp): Promise<void> {
    if (this.isDevelopment) {
      logger.debug('Cache invalidate by pattern', { pattern: pattern.source })
    }

    try {
      let invalidatedCount = 0
      for (const key of this.memoryCache.keys()) {
        if (pattern.test(key)) {
          this.memoryCache.delete(key)
          invalidatedCount++
          if (this.useRedis && this.redisClient) {
            this.redisClient.del(key).catch(() => {})
          }
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
   *
   * @example
   * ```typescript
   * // Clear all user cache
   * const userCache = new BaseCacheService('user:', 3600);
   * await userCache.clear(); // Only clears keys starting with 'user:'
   *
   * // Clear all cache
   * const globalCache = new BaseCacheService('', 900);
   * await globalCache.clear(); // Clears all keys (dangerous!)
   * ```
   */
  async clear(): Promise<void> {
    if (this.isDevelopment) {
      logger.debug(`Cache clear all:[${this.keyPrefix}]`)
    }

    try {
      const memorySize = this.memoryCache.size
      this.memoryCache.clear()

      let redisKeysCleared = 0
      if (this.useRedis && this.redisClient) {
        // Clear only keys with our prefix
        const keys = await this.redisClient.keys?.(`${this.keyPrefix}*`)
        if (keys && keys.length > 0) {
          redisKeysCleared = keys.length
          await this.redisClient.del(keys)
        }
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
   *
   * @private
   * @param key - The base cache key
   * @returns The full cache key with prefix
   */
  private getFullKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key
  }

  /**
   * Utility method for building hierarchical cache keys from multiple parts
   * Filters out empty/falsy parts and joins with colons
   *
   * @protected
   * @param parts - Array of key parts to join
   * @returns Joined cache key
   *
   * @example
   * ```typescript
   * class UserCacheService extends BaseCacheService {
   *   async cacheUserProfile(userId: string, profileType: string) {
   *     const key = this.buildKey('profile', profileType, userId);
   *     // Result: 'profile:basic:123' or 'profile:extended:456'
   *     await this.set(key, profileData);
   *   }
   *
   *   async cacheUserPreferences(userId: string, category?: string) {
   *     const key = this.buildKey('preferences', category, userId);
   *     // Result: 'preferences:ui:123' or 'preferences:123' (if category is empty)
   *     await this.set(key, preferences);
   *   }
   * }
   * ```
   */
  protected buildKey(...parts: string[]): string {
    return parts.filter(Boolean).join(':')
  }
}
