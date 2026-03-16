// packages/lib/src/cache/org-cache-service.ts

import { type Database, database as ddb } from '@auxx/database'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { createScopedLogger } from '../logger'
import { LocalCache } from './local-cache'
import type { OrgCacheDataMap, OrgCacheKeyName } from './org-cache-keys'
import { ORG_CACHE_KEY_CONFIG } from './org-cache-keys'
import type { CacheProvider } from './org-cache-provider'
import { PromiseMemoizer } from './promise-memoizer'

const logger = createScopedLogger('OrgCache', { color: 'green' })

/** Lock TTL in seconds — auto-releases if holder crashes */
const LOCK_TTL_SECONDS = 5
/** Max retry attempts when waiting for a lock */
const LOCK_MAX_RETRIES = 50
/** Delay between lock retries in ms */
const LOCK_RETRY_DELAY_MS = 100

/**
 * Organization Cache Service — multi-tier, type-safe caching for org-scoped data.
 *
 * Read path (4 stages):
 *   1. Local Map (100ms TTL)
 *   2. Redis hash check (detect cross-process invalidation)
 *   3. Redis data fetch
 *   4. Provider.compute() from DB
 *
 * Write-back: stores in Local + Redis (data + hash)
 * Invalidation: clears local + Redis, recomputes from provider
 */
export class OrganizationCacheService {
  private providers = new Map<OrgCacheKeyName, CacheProvider<any>>()
  private localCache = new LocalCache(100, 1000) // 100ms TTL, 1000 max entries
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
      logger.warn('Redis unavailable, org cache running in local-only mode')
    }
  }

  private async getRedis(): Promise<RedisClient | undefined> {
    await this.redisReady
    return this.redis
  }

  /** Register a provider for a cache key */
  register<K extends OrgCacheKeyName>(key: K, provider: CacheProvider<OrgCacheDataMap[K]>): void {
    this.providers.set(key, provider)
  }

  /** Redis key for the cached data */
  private dataKey(keyName: OrgCacheKeyName, scopeId: string): string {
    return `${ORG_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}:data`
  }

  /** Redis key for the hash (used for cross-process invalidation detection) */
  private hashKey(keyName: OrgCacheKeyName, scopeId: string): string {
    return `${ORG_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}:hash`
  }

  /** Redis key for the distributed lock */
  private lockKey(keyName: OrgCacheKeyName, scopeId: string): string {
    return `${ORG_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}:lock`
  }

  /** Local cache key */
  private localKey(keyName: OrgCacheKeyName, scopeId: string): string {
    return `${ORG_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}`
  }

  /**
   * Main read path — type-safe multi-key fetch.
   * Fetches multiple keys for a single org in one call.
   */
  async getOrRecompute<K extends OrgCacheKeyName[]>(
    orgId: string,
    keys: readonly [...K]
  ): Promise<{ [P in K[number]]: OrgCacheDataMap[P] }> {
    const result = {} as { [P in K[number]]: OrgCacheDataMap[P] }

    // Fetch all keys in parallel
    const entries = await Promise.all(keys.map((key) => this.getSingle(orgId, key)))

    for (let i = 0; i < keys.length; i++) {
      ;(result as any)[keys[i]!] = entries[i]
    }

    return result
  }

  /** Convenience: single key fetch */
  async get<K extends OrgCacheKeyName>(orgId: string, key: K): Promise<OrgCacheDataMap[K]> {
    return this.getSingle(orgId, key)
  }

  /**
   * 4-stage read for a single key.
   * Deduplicates concurrent calls via PromiseMemoizer.
   */
  private async getSingle<K extends OrgCacheKeyName>(
    orgId: string,
    keyName: K
  ): Promise<OrgCacheDataMap[K]> {
    const memoKey = `${keyName}:${orgId}`

    return this.memoizer.memoize(memoKey, async () => {
      const lk = this.localKey(keyName, orgId)

      // Stage 1: Local cache check
      const localEntry = this.localCache.get<OrgCacheDataMap[K]>(lk)
      if (localEntry) {
        return localEntry.value
      }

      const redis = await this.getRedis()

      if (redis) {
        try {
          // Stage 2: Redis hash check
          const [storedHash, localStaleEntry] = await Promise.all([
            redis.get(this.hashKey(keyName, orgId)),
            Promise.resolve(this.localCache.get<OrgCacheDataMap[K]>(lk)), // re-check after await
          ])

          // If we have a stale local entry with matching hash, it's still valid
          if (localStaleEntry && storedHash && localStaleEntry.hash === storedHash) {
            // Refresh the local entry timestamp
            this.localCache.set(lk, localStaleEntry.value, storedHash)
            return localStaleEntry.value
          }

          // Stage 3: Redis data fetch
          if (storedHash) {
            const config = ORG_CACHE_KEY_CONFIG[keyName]
            if (!config.localOnly) {
              const rawData = await redis.get(this.dataKey(keyName, orgId))
              if (rawData) {
                const value = JSON.parse(rawData) as OrgCacheDataMap[K]
                this.localCache.set(lk, value, storedHash)
                return value
              }
            }
          }
        } catch (error) {
          logger.warn(`Redis error reading ${keyName} for org ${orgId}`, {
            error: error instanceof Error ? error.message : String(error),
          })
          // Fall through to recompute
        }
      }

      // Stage 4: Recompute from provider
      return this.recompute(orgId, keyName)
    })
  }

  /**
   * Compute value from provider and write back to cache.
   * Uses distributed lock to prevent thundering herd.
   */
  private async recompute<K extends OrgCacheKeyName>(
    orgId: string,
    keyName: K
  ): Promise<OrgCacheDataMap[K]> {
    const provider = this.providers.get(keyName)
    if (!provider) {
      throw new Error(`No provider registered for cache key: ${keyName}`)
    }

    const redis = await this.getRedis()

    // Try to acquire distributed lock
    if (redis) {
      const lock = this.lockKey(keyName, orgId)
      try {
        const acquired = await redis.set(lock, '1', 'EX', LOCK_TTL_SECONDS, 'NX')

        if (!acquired) {
          // Another process is computing — wait and retry from Redis
          for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
            await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS))

            const rawData = await redis.get(this.dataKey(keyName, orgId))
            if (rawData) {
              const hash = (await redis.get(this.hashKey(keyName, orgId))) || randomUUID()
              const value = JSON.parse(rawData) as OrgCacheDataMap[K]
              this.localCache.set(this.localKey(keyName, orgId), value, hash)
              return value
            }
          }
          // Lock holder may have failed — fall through to compute anyway
        }
      } catch {
        // Lock acquisition failed — proceed without lock
      }
    }

    try {
      const value = await provider.compute(orgId, this.db)
      await this.writeBack(orgId, keyName, value)
      return value
    } finally {
      // Release lock
      if (redis) {
        try {
          await redis.del(this.lockKey(keyName, orgId))
        } catch {
          // Ignore lock release errors
        }
      }
    }
  }

  /** Write computed value back to local cache and Redis */
  private async writeBack<K extends OrgCacheKeyName>(
    orgId: string,
    keyName: K,
    value: OrgCacheDataMap[K]
  ): Promise<void> {
    const hash = randomUUID()
    const config = ORG_CACHE_KEY_CONFIG[keyName]
    const lk = this.localKey(keyName, orgId)

    // Write to local cache
    this.localCache.set(lk, value, hash)

    // Write to Redis
    const redis = await this.getRedis()
    if (redis) {
      try {
        const pipeline = redis.pipeline()

        // Always store hash in Redis (for cross-process invalidation)
        pipeline.set(this.hashKey(keyName, orgId), hash)
        pipeline.expire(this.hashKey(keyName, orgId), config.ttlSeconds)

        // Store data in Redis unless local-only
        if (!config.localOnly) {
          const serialized = JSON.stringify(value)
          pipeline.set(this.dataKey(keyName, orgId), serialized)
          pipeline.expire(this.dataKey(keyName, orgId), config.ttlSeconds)
        }

        await pipeline.exec()
      } catch (error) {
        logger.warn(`Redis write error for ${keyName}:${orgId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Invalidate specific keys and recompute them.
   * MUST be called AFTER the DB transaction commits.
   */
  async invalidateAndRecompute(orgId: string, keys: readonly OrgCacheKeyName[]): Promise<void> {
    const redis = await this.getRedis()

    await Promise.all(
      keys.map(async (keyName) => {
        const lk = this.localKey(keyName, orgId)

        // Clear local cache
        this.localCache.delete(lk)

        // Delete Redis keys (data + hash)
        if (redis) {
          try {
            await redis.del(this.dataKey(keyName, orgId))
            await redis.del(this.hashKey(keyName, orgId))
          } catch {
            // Ignore Redis errors during invalidation
          }
        }

        // Recompute if provider is registered
        if (this.providers.has(keyName)) {
          try {
            await this.recompute(orgId, keyName)
          } catch (error) {
            logger.warn(`Recompute failed for ${keyName}:${orgId}`, {
              error: error instanceof Error ? error.message : String(error),
            })
            // Next read will retry
          }
        }
      })
    )
  }

  /**
   * Flush all (or specific) keys for an org.
   * Does NOT recompute — next read will trigger recompute.
   */
  async flush(orgId: string, keys?: readonly OrgCacheKeyName[]): Promise<void> {
    const keysToFlush = keys ?? (Object.keys(ORG_CACHE_KEY_CONFIG) as OrgCacheKeyName[])
    const redis = await this.getRedis()

    for (const keyName of keysToFlush) {
      this.localCache.delete(this.localKey(keyName, orgId))

      if (redis) {
        try {
          await redis.del(this.dataKey(keyName, orgId))
          await redis.del(this.hashKey(keyName, orgId))
        } catch {
          // Ignore
        }
      }
    }
  }
}
