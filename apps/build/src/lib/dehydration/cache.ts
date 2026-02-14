// apps/build/src/lib/dehydration/cache.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import type { BuildDehydratedState } from './types'

const logger = createScopedLogger('dehydration-cache')

const CACHE_PREFIX = 'build-dehydrated'
const CACHE_TTL = 300 // 5 minutes

/**
 * Cache service for build dehydrated state
 */
export class BuildDehydrationCacheService {
  /**
   * Get cached state for a user
   */
  async getState(userId: string): Promise<BuildDehydratedState | null> {
    try {
      const redis = await getRedisClient(false)
      if (!redis) return null

      const key = this.getCacheKey(userId)
      const cached = await redis.get(key)

      if (!cached) {
        return null
      }

      return JSON.parse(cached) as BuildDehydratedState
    } catch (error) {
      logger.error('Failed to get cached state', { userId, error })
      return null
    }
  }

  /**
   * Set cached state for a user
   */
  async setState(userId: string, state: BuildDehydratedState): Promise<void> {
    try {
      const redis = await getRedisClient(false)
      if (!redis) return

      const key = this.getCacheKey(userId)
      await redis.setex(key, CACHE_TTL, JSON.stringify(state))
    } catch (error) {
      logger.error('Failed to set cached state', { userId, error })
    }
  }

  /**
   * Invalidate cached state for a user
   */
  async invalidateUser(userId: string): Promise<void> {
    try {
      const redis = await getRedisClient(false)
      if (!redis) return

      const key = this.getCacheKey(userId)
      await redis.del(key)
      logger.debug(`Invalidated cache for user ${userId}`)
    } catch (error) {
      logger.error('Failed to invalidate user cache', { userId, error })
    }
  }

  /**
   * Get cache key for a user
   */
  private getCacheKey(userId: string): string {
    return `${CACHE_PREFIX}:${userId}`
  }
}
