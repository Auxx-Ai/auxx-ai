// packages/lib/src/dehydration/cache.ts

import { BaseCacheService } from '../cache/base-cache-service'
import type { DehydratedState } from './types'

/**
 * Cache service for dehydrated state
 * Uses 5 minute TTL and tag-based invalidation
 */
export class DehydrationCacheService extends BaseCacheService {
  constructor() {
    super('dehydrated', 300) // 5 minute TTL
  }

  /**
   * Get cached dehydrated state for a user
   * @param userId - User ID
   * @returns Cached dehydrated state or null if not found
   */
  async getState(userId: string): Promise<DehydratedState | null> {
    return this.get<DehydratedState>(this.buildKey('user', userId))
  }

  /**
   * Cache dehydrated state for a user
   * @param userId - User ID
   * @param state - Dehydrated state to cache
   */
  async setState(userId: string, state: DehydratedState): Promise<void> {
    const key = this.buildKey('user', userId)
    const tags = [
      `user:${userId}`,
      ...state.organizations.map((org) => `org:${org.id}`),
    ]

    await this.set(key, state, { tags })
  }

  /**
   * Invalidate cache for a specific user
   * @param userId - User ID
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.invalidateByTag(`user:${userId}`)
  }

  /**
   * Invalidate cache for all users in an organization
   * @param organizationId - Organization ID
   */
  async invalidateOrganization(organizationId: string): Promise<void> {
    await this.invalidateByTag(`org:${organizationId}`)
  }

  /**
   * Invalidate user settings cache when settings change
   * @param userId - User ID
   */
  async invalidateUserSettings(userId: string): Promise<void> {
    await this.invalidateByTag(`user:${userId}`)
  }
}
