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

    // Compute id matches the cache scope id: bare userId for user-scoped keys,
    // `userId:orgId` for org-scoped keys. Forwarding orgId regardless of scope
    // here would call providers like userProfile with `userId:orgId`, which has
    // no matching User row and silently poisons the cache with null.
    const sid = this.scopeId(userId, keyName, orgId)
    const value = await provider.compute(sid, this.db)

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
   *
   * **Two phases, and the split is load-bearing.** EVERY key in the batch is
   * deleted (local + Redis) before ANY of them recomputes, because user providers
   * read each other: `userMailVisibility` composes from `userCapabilities` (plan
   * 40 §4.2/§4.4). Interleaving delete-and-recompute per key — which is what a
   * single `Promise.all` over "delete then recompute" did — left a window where
   * the mail provider's read-through could still hit the sibling's not-yet-deleted
   * Redis entry and pin a STALE capability blob into the fresh mail blob, for the
   * full ONE_DAY TTL. `Promise.all` gives no ordering, so declaring the keys in
   * dependency order in `INVALIDATION_GRAPH` would not have fixed it either.
   *
   * With the delete phase completed first, a dependency read is guaranteed to miss
   * and recompute — so read-through, not ordering, is what makes the graph safe,
   * and a new inter-provider dependency needs no scheduling work.
   */
  async invalidateAndRecompute(
    userId: string,
    keys: readonly UserCacheKeyName[],
    orgId?: string
  ): Promise<void> {
    const redis = await this.getRedis()

    // Phase 1 — delete everything in the batch.
    await Promise.all(
      keys.map(async (keyName) => {
        const sid = this.scopeId(userId, keyName, orgId)
        this.localCache.delete(this.localKey(keyName, sid))

        if (redis) {
          try {
            await redis.del(this.dataKey(keyName, sid))
            await redis.del(this.hashKey(keyName, sid))
          } catch {
            // Ignore
          }
        }
      })
    )

    // Phase 2 — recompute. Any provider that reads a sibling key now read-throughs
    // to a freshly computed value rather than a surviving stale one.
    await Promise.all(
      keys.map(async (keyName) => {
        if (!this.providers.has(keyName)) return
        try {
          await this.recompute(userId, keyName, orgId)
        } catch (error) {
          logger.warn(`Recompute failed for ${keyName}:${userId}`, {
            error: error instanceof Error ? error.message : String(error),
          })
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

  /**
   * Flush specific cache keys for ALL users, by Redis SCAN over the key's prefix.
   * Does NOT recompute — the next read per user triggers a lazy recompute.
   *
   * The `vN` in each prefix ({@link USER_CACHE_KEY_CONFIG}) remains the mechanism
   * for a real rollout: a shape change that reaches users bumps it, so old and
   * new blobs occupy different keyspaces and a draining old instance cannot
   * repopulate the new one. A flush cannot give that guarantee mid-deploy.
   * This is the counterpart for the dev loop — while a shape is still being
   * iterated on and nothing is live, flushing beats burning a version per edit.
   *
   * Scanning `prefix:*` catches every variant at once: `:data` and `:hash`, and
   * both the plain `userId` and org-scoped `userId:orgId` scopes.
   */
  async flushKeyForAllUsers(keys: readonly UserCacheKeyName[]): Promise<void> {
    for (const keyName of keys) {
      this.localCache.deleteByPrefix(USER_CACHE_KEY_CONFIG[keyName].prefix)
    }

    const redis = await this.getRedis()
    if (!redis) return

    for (const keyName of keys) {
      const prefix = USER_CACHE_KEY_CONFIG[keyName].prefix
      let cursor = '0'
      do {
        const [nextCursor, matchedKeys] = await redis.scan(
          cursor,
          'MATCH',
          `${prefix}:*`,
          'COUNT',
          100
        )
        cursor = nextCursor
        if (matchedKeys.length > 0) {
          await Promise.all(matchedKeys.map((k) => redis.del(k)))
        }
      } while (cursor !== '0')
    }
  }

  /**
   * Invalidate org-scoped user cache keys for ALL members of an organization.
   * Fetches the member list from org cache, then invalidates each member's keys.
   * Call after org-level changes that affect user-scoped data (e.g. shared views, org settings).
   */
  async invalidateOrgUsersForKeys(orgId: string, keys: readonly UserCacheKeyName[]): Promise<void> {
    const { getOrgCache } = await import('./index')
    const members = await getOrgCache().get(orgId, 'members')

    await Promise.all(
      members.map((member) => this.invalidateAndRecompute(member.userId, keys, orgId))
    )
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
