// packages/lib/src/usage/records-count.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { readMeteredDefIds } from './records-metered'

const logger = createScopedLogger('records-count')

/** How stale the cached count may get before the next read recounts. */
export const RECORD_COUNT_TTL_SECONDS = 600

const countKey = (organizationId: string) => `usage:records:count:${organizationId}`

/** Live (non-archived) metered records, counted from Postgres. */
export async function countMeteredRecords(db: Database, organizationId: string): Promise<number> {
  const defIds = await readMeteredDefIds(db, organizationId)
  if (defIds.length === 0) return 0
  const [row] = await db
    .select({ value: count() })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.entityDefinitionId, defIds),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return row?.value ?? 0
}

/**
 * The org's metered record count, served from a short-TTL Redis key and recounted on a miss.
 * `fresh` bypasses the cache and reseeds it. Without Redis every read recounts.
 */
export async function readMeteredRecordCount(
  db: Database,
  organizationId: string,
  opts: { fresh?: boolean } = {}
): Promise<number> {
  const redis = await getRedisClient(false).catch(() => undefined)
  if (redis && !opts.fresh) {
    const cached = await redis.get(countKey(organizationId)).catch(() => null)
    if (cached !== null && cached !== undefined) return Number.parseInt(String(cached), 10) || 0
  }
  const value = await countMeteredRecords(db, organizationId)
  if (redis) {
    await redis
      .set(countKey(organizationId), String(value), 'EX', RECORD_COUNT_TTL_SECONDS)
      .catch((error: Error) =>
        logger.warn('Failed to cache record count', { error: error.message })
      )
  }
  return value
}

// Atomic so a TTL expiry between the check and the increment can't mint a TTL-less key.
const INCR_IF_EXISTS = `if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('INCRBY', KEYS[1], ARGV[1]) end return nil`

/**
 * Add gated creates to the cached count so the gate sees its own writes before the TTL
 * recount. No-op on a missing key: a miss must be seeded from Postgres, not grown from 0.
 */
export async function noteMeteredRecordsCreated(
  organizationId: string,
  quantity: number
): Promise<void> {
  if (quantity <= 0) return
  try {
    const redis = await getRedisClient(false)
    if (!redis) return
    await redis.eval(INCR_IF_EXISTS, 1, countKey(organizationId), String(quantity))
  } catch (error) {
    logger.warn('Failed to bump record count', { error: (error as Error).message })
  }
}

/** Drop the cached count so the next read recounts; for doors that create records outside the CRUD handler. */
export async function invalidateMeteredRecordCount(organizationId: string): Promise<void> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return
    await redis.del(countKey(organizationId))
  } catch (error) {
    logger.warn('Failed to invalidate record count', { error: (error as Error).message })
  }
}
