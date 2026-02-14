// apps/web/src/server/lib/invalidate-build-cache.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

const logger = createScopedLogger('invalidate-build-cache')
const CACHE_PREFIX = 'build-dehydrated'

/**
 * Invalidate build app dehydrated state cache for all members of a developer account
 * This ensures developers see updated app status after admin actions
 *
 * @param developerAccountId - The developer account ID whose members' caches should be invalidated
 */
export async function invalidateBuildCacheForDeveloperAccount(
  developerAccountId: string
): Promise<void> {
  try {
    // Get all members of the developer account
    const members = await database.query.DeveloperAccountMember.findMany({
      where: (members, { eq }) => eq(members.developerAccountId, developerAccountId),
    })

    if (members.length === 0) {
      logger.debug('No members found for developer account', { developerAccountId })
      return
    }

    // Get Redis client
    const redis = await getRedisClient(false)
    if (!redis) {
      logger.warn('Redis not available, cannot invalidate cache')
      return
    }

    // Invalidate cache for each member
    const promises = members.map(async (member) => {
      const key = `${CACHE_PREFIX}:${member.userId}`
      await redis.del(key)
      logger.debug(`Invalidated build cache for user ${member.userId}`)
    })

    await Promise.all(promises)

    logger.info(`Invalidated build cache for ${members.length} developer account members`, {
      developerAccountId,
    })
  } catch (error) {
    logger.error('Failed to invalidate build cache', { developerAccountId, error })
  }
}
