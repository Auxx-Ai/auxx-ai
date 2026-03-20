// apps/build/src/lib/dehydration/service.ts

import { DEV_PORTAL_URL, WEBAPP_URL } from '@auxx/config/client'
import { getBuildUserCache, onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import type {
  BuildDehydratedState,
  DehydratedBuildEnvironment,
  DehydratedDeveloperAccountInvitation,
} from './types'

const logger = createScopedLogger('build-dehydration-service')

/**
 * Service for generating dehydrated state for developer portal.
 * Thin assembly layer that combines cached keys into BuildDehydratedState.
 */
export class BuildDehydrationService {
  /**
   * Get complete dehydrated state for a user.
   * Reads from the multi-tier BuildUserCacheService.
   */
  async getState(userId: string): Promise<BuildDehydratedState> {
    const cache = getBuildUserCache()

    const { buildDeveloperAccounts, buildApps, buildOrganizations } = await cache.getOrRecompute(
      userId,
      ['buildDeveloperAccounts', 'buildApps', 'buildOrganizations'] as const
    )

    // Fetch user profile from the user cache (already cached separately)
    const { getUserCache } = await import('@auxx/lib/cache')
    const authenticatedUser = await getUserCache().get(userId, 'userProfile')

    // Pending invitations (empty for now — schema doesn't support invitations)
    const invitedDeveloperAccounts: DehydratedDeveloperAccountInvitation[] = []

    // Environment config (computed inline, not cached)
    const environment = this.buildEnvironment()

    return {
      authenticatedUser,
      developerAccounts: buildDeveloperAccounts,
      apps: buildApps,
      organizations: buildOrganizations,
      invitedDeveloperAccounts,
      environment,
      timestamp: Date.now(),
    }
  }

  /**
   * Invalidate cache for a specific user.
   * Flushes all build cache keys for the user.
   */
  async invalidateUser(userId: string): Promise<void> {
    await getBuildUserCache().flush(userId)
  }

  /**
   * Invalidate cache for all members of a developer account.
   * Uses onCacheEvent for consistency with the invalidation graph.
   */
  async invalidateDeveloperAccount(developerAccountId: string): Promise<void> {
    await onCacheEvent('build.app.updated', { developerAccountId })
    await onCacheEvent('build.developer-account.updated', { developerAccountId })
  }

  /** Build environment configuration (not cached) */
  private buildEnvironment(): DehydratedBuildEnvironment {
    return {
      devPortalUrl: DEV_PORTAL_URL || '',
      webappUrl: WEBAPP_URL || '',
      nodeEnv: process.env.NODE_ENV || 'development',
      isDevelopment: process.env.NODE_ENV === 'development',
    }
  }
}
