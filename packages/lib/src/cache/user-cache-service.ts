// packages/lib/src/cache/user-cache-service.ts

import { type Database, database as ddb } from '@auxx/database'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { randomUUID } from 'crypto'
import { createScopedLogger } from '../logger'
import { LocalCache } from './local-cache'
import type { CacheProvider } from './org-cache-provider'
import { PromiseMemoizer } from './promise-memoizer'
import type { UserCacheDataMap, UserCacheKeyName } from './user-cache-keys'
import {
  ORG_SCOPED_USER_KEYS,
  USER_CACHE_KEY_CONFIG,
  USER_KEY_RECOMPUTE_TIERS,
} from './user-cache-keys'

const logger = createScopedLogger('UserCache', { color: 'green' })

/** Members whose keys are deleted concurrently during an org-wide sweep. */
const ORG_SWEEP_CONCURRENCY = 25

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
    // Phase 1 — delete everything in the batch.
    await this.deleteKeys(userId, keys, orgId)

    // Phase 2 — recompute, in dependency tiers (plan 45 §1.4). Read-through has
    // already made this correct in any order; the tiers stop the DEPENDENT key
    // from composing its dependency a second time. `USER_KEY_RECOMPUTE_TIERS`
    // carries the full reasoning, including why the graph's array order and the
    // memoizer are both the wrong lever.
    const remaining = new Set(keys)
    for (const tier of USER_KEY_RECOMPUTE_TIERS) {
      const batch = tier.filter((keyName) => remaining.has(keyName))
      if (batch.length === 0) continue
      for (const keyName of batch) remaining.delete(keyName)
      await this.recomputeBatch(userId, batch, orgId)
    }
    // Unlisted keys have no declared dependency — one concurrent pass.
    await this.recomputeBatch(userId, Array.from(remaining), orgId)
  }

  /** Recompute a set of keys concurrently; a failure warns and never rejects. */
  private async recomputeBatch(
    userId: string,
    keys: readonly UserCacheKeyName[],
    orgId?: string
  ): Promise<void> {
    if (keys.length === 0) return
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

  /**
   * Drop a user's keys from local + Redis. No recompute — the next read
   * composes.
   *
   * Extracted so the org-wide sweep can reuse it: the delete half is what makes
   * an invalidation correct, and the recompute half is only a warm-up.
   */
  private async deleteKeys(
    userId: string,
    keys: readonly UserCacheKeyName[],
    orgId?: string
  ): Promise<void> {
    const redis = await this.getRedis()

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
   * Fetches the member list from org cache, then deletes each member's keys.
   * Call after org-level changes that affect user-scoped data (e.g. shared views,
   * org settings, an inbox default-lens edit, a system-profile edit).
   *
   * **Deletes, does not recompute (plan 45 §1.7), and the two halves are not
   * equally load-bearing.** The delete is what makes the invalidation correct;
   * eagerly composing every member's blob was a warm-up that mostly warmed
   * nothing — in a 200-member org, ~200 concurrent `computeUserMailVisibility`
   * calls for a set of answers that is unchanged for nearly all of them. This is
   * the same delete-only + lazy-read-through contract {@link flushKeyForAllUsers}
   * already documents, and it is strictly SAFER than the eager version: with no
   * explicit recompute there is nothing that can pin a stale sibling, and the
   * double-compose of §1.4 cannot arise here at all.
   *
   * Ordering upstream survives: `onCacheEvent` awaits this before publishing
   * `visibility:changed`, so every client refetch composes post-delete.
   *
   * The cost that remains moves to read-through for the members who are actually
   * connected — a subset of the org, deduped per (key, user) by the memoizer —
   * rather than scaling with member count.
   *
   * `flushKeyForAllUsers` is NOT the shortcut here: its prefix SCAN is key-wide,
   * so it would bust every other org's entries too.
   */
  async invalidateOrgUsersForKeys(orgId: string, keys: readonly UserCacheKeyName[]): Promise<void> {
    const { getOrgCache } = await import('./index')
    const members = await getOrgCache().get(orgId, 'members')

    // Chunked rather than one unbounded `Promise.all`: an org-wide sweep is 2
    // Redis DELs per member per key, and a 200-member org should not open 400
    // round trips at once.
    for (let i = 0; i < members.length; i += ORG_SWEEP_CONCURRENCY) {
      const chunk = members.slice(i, i + ORG_SWEEP_CONCURRENCY)
      await Promise.all(chunk.map((member) => this.deleteKeys(member.userId, keys, orgId)))
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
