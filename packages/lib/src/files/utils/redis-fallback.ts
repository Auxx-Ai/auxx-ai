// packages/lib/src/files/utils/redis-fallback.ts

import { createScopedLogger } from '@auxx/logger'
import type { RedisClient } from '@auxx/redis'

const logger = createScopedLogger('redis-fallback')

/**
 * Redis operation capabilities checker and fallback implementation
 * Provides alternative approaches when sorted set operations aren't available
 */
export class RedisFallback {
  /**
   * Check if sorted set operations are available on Redis client
   */
  static hasSortedSetSupport(redis: RedisClient): boolean {
    return !!(redis.zadd && redis.zrem && redis.zrevrange && redis.zcard)
  }

  /**
   * Check if TTL operations are available on Redis client
   */
  static hasTTLSupport(redis: RedisClient): boolean {
    return !!redis.ttl
  }

  /**
   * Add item to sorted set with fallback to simple keys
   */
  static async zadd(
    redis: RedisClient,
    key: string,
    score: number,
    member: string
  ): Promise<number> {
    if (this.hasSortedSetSupport(redis) && redis.zadd) {
      return await redis.zadd(key, score, member)
    }

    // Fallback: use simple key with timestamp
    const fallbackKey = `${key}:${member}`
    const result = await redis.set(fallbackKey, score.toString())

    // Set expiration if supported
    if (this.hasTTLSupport(redis) && redis.expire) {
      await redis.expire(fallbackKey, 7 * 24 * 60 * 60) // 7 days
    }

    logger.debug('Used fallback for ZADD', { key, member, score })
    return result ? 1 : 0
  }

  /**
   * Remove item from sorted set with fallback
   */
  static async zrem(redis: RedisClient, key: string, ...members: string[]): Promise<number> {
    if (this.hasSortedSetSupport(redis) && redis.zrem) {
      return await redis.zrem(key, ...members)
    }

    // Fallback: delete individual keys
    let removed = 0
    for (const member of members) {
      const fallbackKey = `${key}:${member}`
      const result = await redis.del(fallbackKey)
      removed += result
    }

    logger.debug('Used fallback for ZREM', { key, members })
    return removed
  }

  /**
   * Get range from sorted set with fallback (limited functionality)
   */
  static async zrevrange(
    redis: RedisClient,
    key: string,
    start: number,
    stop: number
  ): Promise<string[]> {
    if (this.hasSortedSetSupport(redis) && redis.zrevrange) {
      return await redis.zrevrange(key, start, stop)
    }

    // Fallback: use keys pattern matching (less efficient)
    if (redis.keys) {
      const pattern = `${key}:*`
      const keys = await redis.keys(pattern)

      // Extract member names and sort by score (best effort)
      const members: Array<{ member: string; score: number }> = []

      for (const fallbackKey of keys) {
        const scoreStr = await redis.get(fallbackKey)
        if (scoreStr) {
          const member = fallbackKey.replace(`${key}:`, '')
          const score = parseFloat(scoreStr)
          members.push({ member, score })
        }
      }

      // Sort by score (descending) and apply range
      members.sort((a, b) => b.score - a.score)
      const endIndex = stop < 0 ? members.length : stop + 1
      return members.slice(start, endIndex).map((m) => m.member)
    }

    logger.warn('No fallback available for ZREVRANGE', { key })
    return []
  }

  /**
   * Get sorted set cardinality with fallback
   */
  static async zcard(redis: RedisClient, key: string): Promise<number> {
    if (this.hasSortedSetSupport(redis) && redis.zcard) {
      return await redis.zcard(key)
    }

    // Fallback: count keys with pattern
    if (redis.keys) {
      const pattern = `${key}:*`
      const keys = await redis.keys(pattern)
      return keys.length
    }

    logger.warn('No fallback available for ZCARD', { key })
    return 0
  }

  /**
   * Get TTL with fallback
   */
  static async ttl(redis: RedisClient, key: string): Promise<number> {
    if (this.hasTTLSupport(redis) && redis.ttl) {
      return await redis.ttl(key)
    }

    // Fallback: assume no expiration
    logger.debug('TTL not supported, assuming no expiration', { key })
    return -1 // Redis convention for keys without expiration
  }

  /**
   * Set expiration with fallback
   */
  static async expire(redis: RedisClient, key: string, seconds: number): Promise<number> {
    if (redis.expire) {
      return await redis.expire(key, seconds)
    }

    // Fallback: log warning and continue
    logger.warn('EXPIRE not supported, key will not expire', { key, seconds })
    return 1 // Pretend it succeeded
  }

  /**
   * Log capabilities information for debugging
   */
  static logCapabilities(redis: RedisClient): void {
    const sortedSets = this.hasSortedSetSupport(redis)
    const ttl = this.hasTTLSupport(redis)

    logger.info('Redis capabilities detected', {
      sortedSets,
      ttl,
      operations: {
        zadd: !!redis.zadd,
        zrem: !!redis.zrem,
        zrevrange: !!redis.zrevrange,
        zcard: !!redis.zcard,
        ttl: !!redis.ttl,
        expire: !!redis.expire,
        keys: !!redis.keys,
      },
    })
  }
}
