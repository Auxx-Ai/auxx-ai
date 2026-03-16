// packages/lib/src/resources/registry/entity-def-resolver.ts

import type { Database } from '@auxx/database'
import type { EntityDefinitionType } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'

/**
 * Resolves an EntityDefinitionType to its entityDefinitionId (CUID).
 * Now served from the org cache (30-day TTL, near-immutable).
 *
 * @param organizationId - The organization ID
 * @param entityType - The entity definition type (contact, part, ticket, etc.)
 * @param _db - Database instance (no longer used, kept for backward compat)
 * @returns The entityDefinitionId (CUID)
 * @throws Error if EntityDefinition not found (indicates seeding problem)
 */
export async function resolveEntityDefTypeId(
  organizationId: string,
  entityType: EntityDefinitionType,
  _db: Database
): Promise<string> {
  const { entityDefs } = await getOrgCache().getOrRecompute(organizationId, ['entityDefs'])
  const resolved = entityDefs[entityType]

  if (!resolved) {
    throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
  }

  return resolved
}
