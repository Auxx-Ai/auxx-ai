// packages/lib/src/email/polling-import-cache.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

const logger = createScopedLogger('polling-import-cache')

const CACHE_PREFIX = 'poll-import:'
const CACHE_TTL = 3600 // 1 hour — safety expiry to prevent leaks

function cacheKey(integrationId: string): string {
  return `${CACHE_PREFIX}${integrationId}`
}

/** Add discovered message IDs to the import cache */
export async function addToImportCache(integrationId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return

  const redis = await getRedisClient()
  if (!redis) return

  const key = cacheKey(integrationId)

  await redis.sadd(key, ...messageIds)
  await redis.expire(key, CACHE_TTL)

  logger.debug('Added message IDs to import cache', {
    integrationId,
    count: messageIds.length,
  })
}

/** Pop a batch of message IDs from the import cache (SPOP) */
export async function popFromImportCache(integrationId: string, count: number): Promise<string[]> {
  const redis = await getRedisClient()
  if (!redis) return []

  const key = cacheKey(integrationId)

  const ids = await redis.spop(key, count)
  if (!ids) return []
  return Array.isArray(ids) ? ids : [ids]
}

/** Get remaining count in cache */
export async function getImportCacheSize(integrationId: string): Promise<number> {
  const redis = await getRedisClient()
  if (!redis) return 0

  return redis.scard(cacheKey(integrationId))
}

/** Clear the cache (on full sync reset or cleanup) */
export async function clearImportCache(integrationId: string): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return

  await redis.del(cacheKey(integrationId))

  logger.debug('Cleared import cache', { integrationId })
}
