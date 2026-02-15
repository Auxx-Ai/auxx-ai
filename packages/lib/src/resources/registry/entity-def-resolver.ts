// packages/lib/src/resources/registry/entity-def-resolver.ts

import type { Database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import type { EntityDefinitionType } from '@auxx/types/resource'

/** Cache key format: entity-def:{organizationId}:{entityType} */
const ENTITY_DEF_CACHE_PREFIX = 'entity-def'

/** TTL: 30 days (2592000 seconds) - these values never change */
const ENTITY_DEF_CACHE_TTL = 60 * 60 * 24 * 30

/**
 * Resolves an EntityDefinitionType to its entityDefinitionId (CUID).
 * Uses Redis caching with long TTL since these values never change.
 *
 * @param organizationId - The organization ID
 * @param entityType - The entity definition type (contact, part, ticket, etc.)
 * @param db - Database instance
 * @returns The entityDefinitionId (CUID)
 * @throws Error if EntityDefinition not found (indicates seeding problem)
 */
export async function resolveEntityDefTypeId(
  organizationId: string,
  entityType: EntityDefinitionType,
  db: Database
): Promise<string> {
  const cacheKey = `${ENTITY_DEF_CACHE_PREFIX}:${organizationId}:${entityType}`

  // Try cache first
  const redis = await getRedisClient(false)
  if (redis) {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  // Query database
  const entityDef = await db.query.EntityDefinition.findFirst({
    where: (defs, { eq, and }) =>
      and(eq(defs.organizationId, organizationId), eq(defs.entityType, entityType)),
    columns: { id: true },
  })

  if (!entityDef) {
    throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
  }

  // Cache the result with long TTL
  if (redis) {
    await redis.setex(cacheKey, ENTITY_DEF_CACHE_TTL, entityDef.id)
  }

  return entityDef.id
}
