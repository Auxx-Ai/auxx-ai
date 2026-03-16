// packages/lib/src/cache/app-cache-service.ts

import { type Database, database as ddb } from '@auxx/database'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { createScopedLogger } from '../logger'
import type { AppCacheDataMap, AppCacheKeyName } from './app-cache-keys'
import { APP_CACHE_KEY_CONFIG } from './app-cache-keys'
import type { AppCacheProvider } from './app-cache-provider'
import { LocalCache } from './local-cache'
import { PromiseMemoizer } from './promise-memoizer'

const logger = createScopedLogger('AppCache', { color: 'blue' })

/**
 * Application-wide cache for global (non-scoped) data.
 *
 * Simplified version of OrganizationCacheService:
 * - No scope ID — keys are singleton
 * - Higher local TTL (5s) — global data has no cross-org staleness concerns
 * - No distributed lock — global data is idempotent to compute
 * - Same Redis hash check for cross-process invalidation detection
 *
 * Read path (4 stages):
 *   1. Local Map (5s TTL)
 *   2. Redis hash check (detect cross-process invalidation)
 *   3. Redis data fetch
 *   4. Provider.compute() from DB
 */
export class AppCacheService {
  private providers = new Map<AppCacheKeyName, AppCacheProvider<any>>()
  private localCache = new LocalCache(5000, 50) // 5s TTL, 50 max entries
  private memoizer = new PromiseMemoizer<any>()
  private redis: RedisClient | undefined
  private redisReady: Promise<void>
  private db: Database

  constructor(db?: Database) {
    this.db = db ?? (ddb as Database)
    this.redisReady = this.initRedis()
  }

  private async initRedis(): Promise<void> {
    try {
      this.redis = await getRedisClient(false)
    } catch {
      logger.warn('Redis unavailable, app cache running in local-only mode')
    }
  }

  private async getRedis(): Promise<RedisClient | undefined> {
    await this.redisReady
    return this.redis
  }

  /** Register a provider for a cache key */
  register<K extends AppCacheKeyName>(
    key: K,
    provider: AppCacheProvider<AppCacheDataMap[K]>
  ): void {
    this.providers.set(key, provider)
  }

  /** Redis key for the cached data */
  private dataKey(keyName: AppCacheKeyName): string {
    return `${APP_CACHE_KEY_CONFIG[keyName].prefix}:data`
  }

  /** Redis key for the hash (used for cross-process invalidation detection) */
  private hashKey(keyName: AppCacheKeyName): string {
    return `${APP_CACHE_KEY_CONFIG[keyName].prefix}:hash`
  }

  /** Local cache key */
  private localKey(keyName: AppCacheKeyName): string {
    return APP_CACHE_KEY_CONFIG[keyName].prefix
  }

  /** Convenience: single key fetch */
  async get<K extends AppCacheKeyName>(key: K): Promise<AppCacheDataMap[K]> {
    return this.getSingle(key)
  }

  /**
   * Multi-key fetch — type-safe.
   * Fetches multiple keys in parallel in one call.
   */
  async getOrRecompute<K extends AppCacheKeyName[]>(
    keys: readonly [...K]
  ): Promise<{ [P in K[number]]: AppCacheDataMap[P] }> {
    const result = {} as { [P in K[number]]: AppCacheDataMap[P] }
    const entries = await Promise.all(keys.map((key) => this.getSingle(key)))

    for (let i = 0; i < keys.length; i++) {
      ;(result as any)[keys[i]!] = entries[i]
    }

    return result
  }

  /**
   * 4-stage read for a single key.
   * Deduplicates concurrent calls via PromiseMemoizer.
   */
  private async getSingle<K extends AppCacheKeyName>(keyName: K): Promise<AppCacheDataMap[K]> {
    return this.memoizer.memoize(keyName, async () => {
      const lk = this.localKey(keyName)

      // Stage 1: Local cache check
      const localEntry = this.localCache.get<AppCacheDataMap[K]>(lk)
      if (localEntry) {
        return localEntry.value
      }

      const redis = await this.getRedis()

      if (redis) {
        try {
          // Stage 2: Redis hash check
          const [storedHash, localStaleEntry] = await Promise.all([
            redis.get(this.hashKey(keyName)),
            Promise.resolve(this.localCache.get<AppCacheDataMap[K]>(lk)),
          ])

          // If we have a stale local entry with matching hash, it's still valid
          if (localStaleEntry && storedHash && localStaleEntry.hash === storedHash) {
            this.localCache.set(lk, localStaleEntry.value, storedHash)
            return localStaleEntry.value
          }

          // Stage 3: Redis data fetch
          if (storedHash) {
            const rawData = await redis.get(this.dataKey(keyName))
            if (rawData) {
              const value = JSON.parse(rawData) as AppCacheDataMap[K]
              this.localCache.set(lk, value, storedHash)
              return value
            }
          }
        } catch (error) {
          logger.warn(`Redis error reading ${keyName}`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Stage 4: Recompute from provider
      return this.recompute(keyName)
    })
  }

  /** Compute value from provider and write back to cache */
  private async recompute<K extends AppCacheKeyName>(keyName: K): Promise<AppCacheDataMap[K]> {
    const provider = this.providers.get(keyName)
    if (!provider) {
      throw new Error(`No provider registered for app cache key: ${keyName}`)
    }

    const value = await provider.compute(this.db)
    await this.writeBack(keyName, value)
    return value
  }

  /** Write computed value back to local cache and Redis */
  private async writeBack<K extends AppCacheKeyName>(
    keyName: K,
    value: AppCacheDataMap[K]
  ): Promise<void> {
    const hash = randomUUID()
    const config = APP_CACHE_KEY_CONFIG[keyName]
    const lk = this.localKey(keyName)

    // Write to local cache
    this.localCache.set(lk, value, hash)

    // Write to Redis
    const redis = await this.getRedis()
    if (redis) {
      try {
        const pipeline = redis.pipeline()
        pipeline.set(this.hashKey(keyName), hash)
        pipeline.expire(this.hashKey(keyName), config.ttlSeconds)
        pipeline.set(this.dataKey(keyName), JSON.stringify(value))
        pipeline.expire(this.dataKey(keyName), config.ttlSeconds)
        await pipeline.exec()
      } catch (error) {
        logger.warn(`Redis write error for ${keyName}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Invalidate specific keys and recompute them.
   * MUST be called AFTER the DB transaction commits.
   */
  async invalidateAndRecompute(keys: readonly AppCacheKeyName[]): Promise<void> {
    const redis = await this.getRedis()

    await Promise.all(
      keys.map(async (keyName) => {
        const lk = this.localKey(keyName)

        // Clear local cache
        this.localCache.delete(lk)

        // Delete Redis keys (data + hash)
        if (redis) {
          try {
            await redis.del(this.dataKey(keyName))
            await redis.del(this.hashKey(keyName))
          } catch {
            // Ignore Redis errors during invalidation
          }
        }

        // Recompute if provider is registered
        if (this.providers.has(keyName)) {
          try {
            await this.recompute(keyName)
          } catch (error) {
            logger.warn(`Recompute failed for app cache key ${keyName}`, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    )
  }

  /**
   * Flush all (or specific) keys.
   * Does NOT recompute — next read will trigger recompute.
   */
  async flush(keys?: readonly AppCacheKeyName[]): Promise<void> {
    const keysToFlush = keys ?? (Object.keys(APP_CACHE_KEY_CONFIG) as AppCacheKeyName[])
    const redis = await this.getRedis()

    for (const keyName of keysToFlush) {
      this.localCache.delete(this.localKey(keyName))

      if (redis) {
        try {
          await redis.del(this.dataKey(keyName))
          await redis.del(this.hashKey(keyName))
        } catch {
          // Ignore
        }
      }
    }
  }
}
