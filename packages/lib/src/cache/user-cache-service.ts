// packages/lib/src/cache/user-cache-service.ts

import { type Database, database as ddb } from '@auxx/database'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { createScopedLogger } from '../logger'
import { LocalCache } from './local-cache'
import type { CacheProvider } from './org-cache-provider'
import { PromiseMemoizer } from './promise-memoizer'
import type { UserCacheDataMap, UserCacheKeyName } from './user-cache-keys'
import { ORG_SCOPED_USER_KEYS, USER_CACHE_KEY_CONFIG } from './user-cache-keys'

const logger = createScopedLogger('UserCache', { color: 'green' })

/**
 * User Cache Service — same multi-tier pattern as OrganizationCacheService
 * but keyed by userId (or userId:orgId for org-scoped user data).
 */
export class UserCacheService {
  private providers = new Map<UserCacheKeyName, CacheProvider<any>>()
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
      logger.warn('Redis unavailable, user cache running in local-only mode')
    }
  }

  private async getRedis(): Promise<RedisClient | undefined> {
    await this.redisReady
    return this.redis
  }

  register<K extends UserCacheKeyName>(key: K, provider: CacheProvider<UserCacheDataMap[K]>): void {
    this.providers.set(key, provider)
  }

  /** Build the scope ID based on whether the key is org-scoped */
  private scopeId(userId: string, keyName: UserCacheKeyName, orgId?: string): string {
    if (ORG_SCOPED_USER_KEYS.has(keyName)) {
      if (!orgId) throw new Error(`orgId required for org-scoped user cache key: ${keyName}`)
      return `${userId}:${orgId}`
    }
    return userId
  }

  private dataKey(keyName: UserCacheKeyName, scopeId: string): string {
    return `${USER_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}:data`
  }

  private hashKey(keyName: UserCacheKeyName, scopeId: string): string {
    return `${USER_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}:hash`
  }

  private localKey(keyName: UserCacheKeyName, scopeId: string): string {
    return `${USER_CACHE_KEY_CONFIG[keyName].prefix}:${scopeId}`
  }

  /**
   * Multi-key fetch for a single user.
   * @param orgId Required for org-scoped keys (userSettings, userMailViews)
   */
  async getOrRecompute<K extends UserCacheKeyName[]>(
    userId: string,
    keys: readonly [...K],
    orgId?: string
  ): Promise<{ [P in K[number]]: UserCacheDataMap[P] }> {
    const result = {} as { [P in K[number]]: UserCacheDataMap[P] }

    const entries = await Promise.all(keys.map((key) => this.getSingle(userId, key, orgId)))

    for (let i = 0; i < keys.length; i++) {
      ;(result as any)[keys[i]!] = entries[i]
    }

    return result
  }

  async get<K extends UserCacheKeyName>(
    userId: string,
    key: K,
    orgId?: string
  ): Promise<UserCacheDataMap[K]> {
    return this.getSingle(userId, key, orgId)
  }

  private async getSingle<K extends UserCacheKeyName>(
    userId: string,
    keyName: K,
    orgId?: string
  ): Promise<UserCacheDataMap[K]> {
    const sid = this.scopeId(userId, keyName, orgId)
    const memoKey = `${keyName}:${sid}`

    return this.memoizer.memoize(memoKey, async () => {
      const lk = this.localKey(keyName, sid)

      // Stage 1: Local cache
      const localEntry = this.localCache.get<UserCacheDataMap[K]>(lk)
      if (localEntry) return localEntry.value

      const redis = await this.getRedis()

      if (redis) {
        try {
          // Stage 2: Redis hash check
          const storedHash = await redis.get(this.hashKey(keyName, sid))

          // Stage 3: Redis data fetch
          if (storedHash) {
            const rawData = await redis.get(this.dataKey(keyName, sid))
            if (rawData) {
              const value = JSON.parse(rawData) as UserCacheDataMap[K]
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
      return this.recompute(userId, keyName, orgId)
    })
  }

  private async recompute<K extends UserCacheKeyName>(
    userId: string,
    keyName: K,
    orgId?: string
  ): Promise<UserCacheDataMap[K]> {
    const provider = this.providers.get(keyName)
    if (!provider) {
      throw new Error(`No provider registered for user cache key: ${keyName}`)
    }

    // For user cache, compute receives userId as the "orgId" parameter
    // Org-scoped keys pass orgId as well (via a combined ID)
    const computeId = orgId ? `${userId}:${orgId}` : userId
    const value = await provider.compute(computeId, this.db)

    const sid = this.scopeId(userId, keyName, orgId)
    await this.writeBack(sid, keyName, value)

    return value
  }

  private async writeBack<K extends UserCacheKeyName>(
    scopeId: string,
    keyName: K,
    value: UserCacheDataMap[K]
  ): Promise<void> {
    const hash = randomUUID()
    const config = USER_CACHE_KEY_CONFIG[keyName]
    const lk = this.localKey(keyName, scopeId)

    this.localCache.set(lk, value, hash)

    const redis = await this.getRedis()
    if (redis) {
      try {
        const pipeline = redis.pipeline()
        pipeline.set(this.hashKey(keyName, scopeId), hash)
        pipeline.expire(this.hashKey(keyName, scopeId), config.ttlSeconds)
        pipeline.set(this.dataKey(keyName, scopeId), JSON.stringify(value))
        pipeline.expire(this.dataKey(keyName, scopeId), config.ttlSeconds)
        await pipeline.exec()
      } catch (error) {
        logger.warn(`Redis write error for ${keyName}:${scopeId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Invalidate and recompute specific keys for a user.
   */
  async invalidateAndRecompute(
    userId: string,
    keys: readonly UserCacheKeyName[],
    orgId?: string
  ): Promise<void> {
    const redis = await this.getRedis()

    await Promise.all(
      keys.map(async (keyName) => {
        const sid = this.scopeId(userId, keyName, orgId)
        const lk = this.localKey(keyName, sid)

        this.localCache.delete(lk)

        if (redis) {
          try {
            await redis.del(this.dataKey(keyName, sid))
            await redis.del(this.hashKey(keyName, sid))
          } catch {
            // Ignore
          }
        }

        if (this.providers.has(keyName)) {
          try {
            await this.recompute(userId, keyName, orgId)
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
  async invalidateUser(userId: string): Promise<void> {
    const allKeys = Object.keys(USER_CACHE_KEY_CONFIG) as UserCacheKeyName[]
    const redis = await this.getRedis()

    for (const keyName of allKeys) {
      // For non-org-scoped keys, flush directly
      if (!ORG_SCOPED_USER_KEYS.has(keyName)) {
        const sid = userId
        this.localCache.delete(this.localKey(keyName, sid))
        if (redis) {
          try {
            await redis.del(this.dataKey(keyName, sid))
            await redis.del(this.hashKey(keyName, sid))
          } catch {
            // Ignore
          }
        }
      }
    }

    // For org-scoped keys, clear by prefix from local cache
    for (const keyName of ORG_SCOPED_USER_KEYS) {
      const prefix = `${USER_CACHE_KEY_CONFIG[keyName].prefix}:${userId}`
      this.localCache.deleteByPrefix(prefix)
      // Note: Redis org-scoped keys can't be efficiently cleared without SCAN.
      // They will expire naturally via TTL.
    }
  }

  /** Flush org-scoped keys for a user in a specific org */
  async invalidateUserForOrg(userId: string, orgId: string): Promise<void> {
    const redis = await this.getRedis()

    for (const keyName of ORG_SCOPED_USER_KEYS) {
      const sid = `${userId}:${orgId}`
      this.localCache.delete(this.localKey(keyName, sid))
      if (redis) {
        try {
          await redis.del(this.dataKey(keyName, sid))
          await redis.del(this.hashKey(keyName, sid))
        } catch {
          // Ignore
        }
      }
    }
  }
}
