// packages/lib/src/snapshot/service.ts

import { createHash } from 'crypto'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { generateId } from '../utils'
import type {
  QuerySnapshot,
  GetOrCreateSnapshotInput,
  SnapshotResult,
  GetSnapshotChunkInput,
  SnapshotChunkResult,
  InvalidateSnapshotsInput,
} from './types'
import type { ConditionGroup } from '../conditions'

/** TTL for snapshots in seconds */
const SNAPSHOT_TTL_SECONDS = 300 // 5 minutes

/** Lock TTL in seconds */
const LOCK_TTL_SECONDS = 30

/** Lock retry delay in ms */
const LOCK_RETRY_DELAY_MS = 100

/** Max lock retries */
const LOCK_MAX_RETRIES = 50 // 5 seconds total

/**
 * Get Redis client instance
 * Throws if Redis is unavailable (snapshot service requires Redis)
 */
async function getClient(): Promise<RedisClient> {
  const client = await getRedisClient(true)
  if (!client) {
    throw new Error('Snapshot service requires Redis')
  }
  return client
}

/**
 * Sleep helper for lock retries
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get or create a query snapshot for a filter configuration
 *
 * Flow:
 * 1. Hash the filter config to create a cache key
 * 2. Check Redis for existing snapshot
 * 3. If found, return cached snapshot
 * 4. If not found, acquire lock, execute query, cache result, return
 */
export async function getOrCreateSnapshot(input: GetOrCreateSnapshotInput): Promise<SnapshotResult> {
  const { organizationId, resourceType, filters, sorting, executeQuery } = input
  const client = await getClient()

  // Generate deterministic hash of filter config
  const filterHash = hashFilterConfig(filters, sorting)
  const cacheKey = buildCacheKey(organizationId, resourceType, filterHash)
  const idsKey = buildIdsKey(cacheKey)

  // Check cache first
  const cachedMeta = await client.get(cacheKey)
  if (cachedMeta) {
    const cached: QuerySnapshot = JSON.parse(cachedMeta)
    // Get all IDs from the list
    const ids = await client.lrange(idsKey, 0, -1)
    return {
      snapshotId: cached.id,
      ids,
      total: cached.total,
      fromCache: true,
    }
  }

  // Cache miss - try to acquire lock to prevent thundering herd
  const lockKey = `lock:${cacheKey}`
  let lockAcquired = false
  let retries = 0

  while (!lockAcquired && retries < LOCK_MAX_RETRIES) {
    const acquired = await client.set(lockKey, '1', 'NX', 'EX', LOCK_TTL_SECONDS)
    if (acquired) {
      lockAcquired = true
    } else {
      // Wait and check if another process cached the result
      await sleep(LOCK_RETRY_DELAY_MS)
      const nowCached = await client.get(cacheKey)
      if (nowCached) {
        const cached: QuerySnapshot = JSON.parse(nowCached)
        const ids = await client.lrange(idsKey, 0, -1)
        return {
          snapshotId: cached.id,
          ids,
          total: cached.total,
          fromCache: true,
        }
      }
      retries++
    }
  }

  // Execute query (either we have lock or gave up waiting)
  try {
    const ids = await executeQuery()

    // Create snapshot metadata
    const snapshot: QuerySnapshot = {
      id: generateId('snap'),
      organizationId,
      resourceType,
      filterHash,
      total: ids.length,
      createdAt: Date.now(),
    }

    // Store metadata
    await client.setex(cacheKey, SNAPSHOT_TTL_SECONDS, JSON.stringify(snapshot))

    // Store IDs as Redis list for efficient slicing
    if (ids.length > 0) {
      await client.del(idsKey) // Clear any stale data
      await client.rpush(idsKey, ...ids)
      await client.expire(idsKey, SNAPSHOT_TTL_SECONDS)
    }

    // Also store reverse lookup by snapshot ID
    await client.setex(
      buildSnapshotKey(snapshot.id),
      SNAPSHOT_TTL_SECONDS,
      JSON.stringify({ cacheKey, idsKey })
    )

    return {
      snapshotId: snapshot.id,
      ids,
      total: ids.length,
      fromCache: false,
    }
  } finally {
    // Release lock
    if (lockAcquired) {
      await client.del(lockKey)
    }
  }
}

/**
 * Get a chunk of IDs from an existing snapshot
 * Returns null if snapshot doesn't exist or expired
 */
export async function getSnapshotChunk(
  input: GetSnapshotChunkInput
): Promise<SnapshotChunkResult | null> {
  const client = await getClient()

  // Look up the cache keys from snapshot ID
  const lookupData = await client.get(buildSnapshotKey(input.snapshotId))
  if (!lookupData) return null

  const { cacheKey, idsKey } = JSON.parse(lookupData)

  // Get metadata for total count
  const metaData = await client.get(cacheKey)
  if (!metaData) return null

  const snapshot: QuerySnapshot = JSON.parse(metaData)

  // Get the requested slice using Redis LRANGE (0-indexed, inclusive end)
  const ids = await client.lrange(idsKey, input.offset, input.offset + input.limit - 1)

  return {
    ids,
    total: snapshot.total,
  }
}

/**
 * Invalidate all snapshots for a resource type
 * Called when records are created/updated/deleted
 * Uses SCAN instead of KEYS to avoid blocking Redis
 */
export async function invalidateSnapshots(input: InvalidateSnapshotsInput): Promise<void> {
  const client = await getClient()
  const pattern = `snapshot:${input.organizationId}:${input.resourceType}:*`

  let cursor = '0'
  do {
    const [newCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = newCursor

    if (keys && keys.length > 0) {
      // Also delete the associated ID lists
      const idsKeys = keys.map((k) => buildIdsKey(k))
      await client.del([...keys, ...idsKeys])
    }
  } while (cursor !== '0')
}

/**
 * Invalidate a specific snapshot by ID
 */
export async function invalidateSnapshot(snapshotId: string): Promise<void> {
  const client = await getClient()

  // Look up the cache keys
  const lookupKey = buildSnapshotKey(snapshotId)
  const lookupData = await client.get(lookupKey)

  if (lookupData) {
    const { cacheKey, idsKey } = JSON.parse(lookupData)
    await client.del([cacheKey, idsKey, lookupKey])
  } else {
    await client.del(lookupKey)
  }
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Build cache key for filter-based lookup
 */
function buildCacheKey(orgId: string, resourceType: string, filterHash: string): string {
  return `snapshot:${orgId}:${resourceType}:${filterHash}`
}

/**
 * Build key for the ID list associated with a cache key
 */
function buildIdsKey(cacheKey: string): string {
  return `${cacheKey}:ids`
}

/**
 * Build cache key for snapshot ID lookup (reverse lookup)
 */
function buildSnapshotKey(snapshotId: string): string {
  return `snapshot:id:${snapshotId}`
}

/**
 * Generate deterministic hash of filter configuration using SHA-256
 * Same filters + sorting = same hash
 */
function hashFilterConfig(
  filters: ConditionGroup[],
  sorting: Array<{ id: string; desc: boolean }>
): string {
  const config = JSON.stringify({ filters, sorting })
  return createHash('sha256').update(config).digest('hex').slice(0, 16)
}
