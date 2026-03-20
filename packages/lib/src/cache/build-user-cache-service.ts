// packages/lib/src/cache/build-user-cache-service.ts

import { type Database, database as ddb } from '@auxx/database'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { createScopedLogger } from '../logger'
import type { BuildUserCacheDataMap, BuildUserCacheKeyName } from './build-user-cache-keys'
import { BUILD_USER_CACHE_KEY_CONFIG } from './build-user-cache-keys'
import { LocalCache } from './local-cache'
import type { CacheProvider } from './org-cache-provider'
import { PromiseMemoizer } from './promise-memoizer'

const logger = createScopedLogger('BuildUserCache', { color: 'green' })

/**
 * Build User Cache Service — multi-tier cache for build portal data.
 * Keyed purely by userId (no org scope).
 * Same 4-stage read pattern as UserCacheService.
 */
export class BuildUserCacheService {
  private providers = new Map<BuildUserCacheKeyName, CacheProvider<any>>()
  private localCache = new LocalCache(100, 1000)
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
      logger.warn('Redis unavailable, build user cache running in local-only mode')
    }
  }

  private async getRedis(): Promise<RedisClient | undefined> {
    await this.redisReady
    return this.redis
  }

  register<K extends BuildUserCacheKeyName>(
    key: K,
    provider: CacheProvider<BuildUserCacheDataMap[K]>
  ): void {
    this.providers.set(key, provider)
  }

  private dataKey(keyName: BuildUserCacheKeyName, userId: string): string {
    return `${BUILD_USER_CACHE_KEY_CONFIG[keyName].prefix}:${userId}:data`
  }

  private hashKey(keyName: BuildUserCacheKeyName, userId: string): string {
    return `${BUILD_USER_CACHE_KEY_CONFIG[keyName].prefix}:${userId}:hash`
  }

  private localKey(keyName: BuildUserCacheKeyName, userId: string): string {
    return `${BUILD_USER_CACHE_KEY_CONFIG[keyName].prefix}:${userId}`
  }

  /** Multi-key fetch for a single user */
  async getOrRecompute<K extends BuildUserCacheKeyName[]>(
    userId: string,
    keys: readonly [...K]
  ): Promise<{ [P in K[number]]: BuildUserCacheDataMap[P] }> {
    const result = {} as { [P in K[number]]: BuildUserCacheDataMap[P] }
    const entries = await Promise.all(keys.map((key) => this.getSingle(userId, key)))

    for (let i = 0; i < keys.length; i++) {
      ;(result as any)[keys[i]!] = entries[i]
    }

    return result
  }

  async get<K extends BuildUserCacheKeyName>(
    userId: string,
    key: K
  ): Promise<BuildUserCacheDataMap[K]> {
    return this.getSingle(userId, key)
  }

  private async getSingle<K extends BuildUserCacheKeyName>(
    userId: string,
    keyName: K
  ): Promise<BuildUserCacheDataMap[K]> {
    const memoKey = `${keyName}:${userId}`

    return this.memoizer.memoize(memoKey, async () => {
      const lk = this.localKey(keyName, userId)

      // Stage 1: Local cache
      const localEntry = this.localCache.get<BuildUserCacheDataMap[K]>(lk)
      if (localEntry) return localEntry.value

      const redis = await this.getRedis()

      if (redis) {
        try {
          // Stage 2: Redis hash check
          const storedHash = await redis.get(this.hashKey(keyName, userId))

          // Stage 3: Redis data fetch
          if (storedHash) {
            const rawData = await redis.get(this.dataKey(keyName, userId))
            if (rawData) {
              const value = JSON.parse(rawData) as BuildUserCacheDataMap[K]
              this.localCache.set(lk, value, storedHash)
              return value
            }
          }
        } catch (error) {
          logger.warn(`Redis error reading ${keyName} for user ${userId}`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Stage 4: Recompute
      return this.recompute(userId, keyName)
    })
  }

  private async recompute<K extends BuildUserCacheKeyName>(
    userId: string,
    keyName: K
  ): Promise<BuildUserCacheDataMap[K]> {
    const provider = this.providers.get(keyName)
    if (!provider) {
      throw new Error(`No provider registered for build user cache key: ${keyName}`)
    }

    const value = await provider.compute(userId, this.db)
    await this.writeBack(userId, keyName, value)
    return value
  }

  private async writeBack<K extends BuildUserCacheKeyName>(
    userId: string,
    keyName: K,
    value: BuildUserCacheDataMap[K]
  ): Promise<void> {
    const hash = randomUUID()
    const config = BUILD_USER_CACHE_KEY_CONFIG[keyName]
    const lk = this.localKey(keyName, userId)

    this.localCache.set(lk, value, hash)

    const redis = await this.getRedis()
    if (redis) {
      try {
        const pipeline = redis.pipeline()
        pipeline.set(this.hashKey(keyName, userId), hash)
        pipeline.expire(this.hashKey(keyName, userId), config.ttlSeconds)
        pipeline.set(this.dataKey(keyName, userId), JSON.stringify(value))
        pipeline.expire(this.dataKey(keyName, userId), config.ttlSeconds)
        await pipeline.exec()
      } catch (error) {
        logger.warn(`Redis write error for ${keyName}:${userId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /** Invalidate and recompute specific keys for a user */
  async invalidateAndRecompute(
    userId: string,
    keys: readonly BuildUserCacheKeyName[]
  ): Promise<void> {
    const redis = await this.getRedis()

    await Promise.all(
      keys.map(async (keyName) => {
        const lk = this.localKey(keyName, userId)
        this.localCache.delete(lk)

        if (redis) {
          try {
            await redis.del(this.dataKey(keyName, userId))
            await redis.del(this.hashKey(keyName, userId))
          } catch {
            // Ignore
          }
        }

        if (this.providers.has(keyName)) {
          try {
            await this.recompute(userId, keyName)
          } catch (error) {
            logger.warn(`Recompute failed for ${keyName}:${userId}`, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    )
  }

  /** Flush all keys for a user */
  async flush(userId: string): Promise<void> {
    const allKeys = Object.keys(BUILD_USER_CACHE_KEY_CONFIG) as BuildUserCacheKeyName[]
    const redis = await this.getRedis()

    for (const keyName of allKeys) {
      this.localCache.delete(this.localKey(keyName, userId))
      if (redis) {
        try {
          await redis.del(this.dataKey(keyName, userId))
          await redis.del(this.hashKey(keyName, userId))
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * Invalidate all members of a developer account for the given keys.
   * Queries DeveloperAccountMember to find all user IDs.
   */
  async invalidateAllMembers(
    developerAccountId: string,
    keys: readonly BuildUserCacheKeyName[]
  ): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { eq } = await import('drizzle-orm')

    const members = await this.db
      .select({ userId: schema.DeveloperAccountMember.userId })
      .from(schema.DeveloperAccountMember)
      .where(eq(schema.DeveloperAccountMember.developerAccountId, developerAccountId))

    await Promise.all(members.map((m) => this.invalidateAndRecompute(m.userId, keys)))
  }
}
