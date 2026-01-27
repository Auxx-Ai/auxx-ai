// packages/lib/src/providers/integration-cache.ts

import { getRedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { IntegrationProviderType } from './types'

/** Cache TTL - provider is immutable, only invalidate on add/remove */
const PROVIDER_MAP_TTL = 86400 // 24 hours

/**
 * Get cached provider map for an organization.
 * Maps integrationId -> provider type.
 *
 * @param organizationId - The ID of the organization
 * @param db - Database instance
 * @returns Map of integrationId to provider type
 */
export async function getOrgProviderMap(
  organizationId: string,
  db: Database
): Promise<Map<string, IntegrationProviderType>> {
  const cacheKey = `org:${organizationId}:integration:providers`

  // Try cache first
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const cached = await redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, IntegrationProviderType>
        return new Map(Object.entries(parsed))
      }
    }
  } catch {
    // Redis unavailable, fall through to DB
  }

  // Fetch from DB
  const integrations = await db
    .select({ id: schema.Integration.id, provider: schema.Integration.provider })
    .from(schema.Integration)
    .where(eq(schema.Integration.organizationId, organizationId))

  const providerMap = new Map(integrations.map((i) => [i.id, i.provider]))

  // Cache result
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      await redis.setex(cacheKey, PROVIDER_MAP_TTL, JSON.stringify(Object.fromEntries(providerMap)))
    }
  } catch {
    // Cache write failed, continue
  }

  return providerMap
}

/**
 * Invalidate cached provider map for an organization.
 * Call when integrations are added or removed.
 *
 * @param organizationId - The ID of the organization
 */
export async function invalidateOrgProviderMap(organizationId: string): Promise<void> {
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      await redis.del(`org:${organizationId}:integration:providers`)
    }
  } catch {
    // Ignore cache invalidation errors
  }
}
