// packages/lib/src/email/polling-import-cache.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

const logger = createScopedLogger('polling-import-cache')

const CACHE_PREFIX = 'poll-import:'
const PROCESSING_PREFIX = 'poll-import-processing:'
const CACHE_TTL = 7200 // 2 hours — increased to survive FAILED state recovery

function cacheKey(integrationId: string): string {
  return `${CACHE_PREFIX}${integrationId}`
}

function processingKey(integrationId: string): string {
  return `${PROCESSING_PREFIX}${integrationId}`
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

/**
 * Move a batch of IDs from the main cache to a processing set.
 * IDs stay in the processing set until explicitly acknowledged.
 * If the job crashes, recoverProcessingBatch() moves them back.
 */
export async function claimImportBatch(integrationId: string, count: number): Promise<string[]> {
  const redis = await getRedisClient()
  if (!redis) return []

  const key = cacheKey(integrationId)
  const procKey = processingKey(integrationId)

  const ids = await redis.spop(key, count)
  if (!ids || (Array.isArray(ids) && ids.length === 0)) return []

  const idArray = Array.isArray(ids) ? ids : [ids]

  await redis.sadd(procKey, ...idArray)
  await redis.expire(procKey, CACHE_TTL)

  return idArray
}

/**
 * Acknowledge successful import — remove from processing set.
 */
export async function acknowledgeImportBatch(
  integrationId: string,
  messageIds: string[]
): Promise<void> {
  if (messageIds.length === 0) return
  const redis = await getRedisClient()
  if (!redis) return

  await redis.srem(processingKey(integrationId), ...messageIds)
}

/**
 * Recover a crashed batch — move processing set back to main cache.
 * Called during stale-check recovery and lock-loss recovery.
 */
export async function recoverProcessingBatch(integrationId: string): Promise<number> {
  const redis = await getRedisClient()
  if (!redis) return 0

  const procKey = processingKey(integrationId)
  const key = cacheKey(integrationId)

  const ids = await redis.smembers(procKey)
  if (ids.length === 0) return 0

  await redis.sadd(key, ...ids)
  await redis.del(procKey)
  await redis.expire(key, CACHE_TTL)

  return ids.length
}

/** Pop a batch of message IDs from the import cache (SPOP) — legacy, prefer claimImportBatch */
export async function popFromImportCache(integrationId: string, count: number): Promise<string[]> {
  const redis = await getRedisClient()
  if (!redis) return []

  const key = cacheKey(integrationId)

  const ids = await redis.spop(key, count)
  if (!ids) return []
  return Array.isArray(ids) ? ids : [ids]
}

/** Get remaining count in cache (includes both main and processing sets) */
export async function getImportCacheSize(integrationId: string): Promise<number> {
  const redis = await getRedisClient()
  if (!redis) return 0

  const [cacheCount, processingCount] = await Promise.all([
    redis.scard(cacheKey(integrationId)),
    redis.scard(processingKey(integrationId)),
  ])
  return cacheCount + processingCount
}

/** Clear the cache (both main and processing sets) */
export async function clearImportCache(integrationId: string): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return

  await redis.del(cacheKey(integrationId), processingKey(integrationId))

  logger.debug('Cleared import cache', { integrationId })
}
