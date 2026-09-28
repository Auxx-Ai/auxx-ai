// packages/lib/src/usage/records-metered.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { findCachedResource, getCachedResources } from '../cache'
import type { Resource } from '../resources/registry/types'

/**
 * Pure part of the classification: an EntityDefinition-backed resource whose
 * behavior is `metered`, minus the connector child-mapping targets passed in.
 */
export function isMeteredResource(
  resource: Resource,
  childMappingDefIds: ReadonlySet<string>
): boolean {
  if (resource.type !== 'custom' || !resource.metered) return false
  return !(resource.dataConnectorId && childMappingDefIds.has(resource.entityDefinitionId))
}

/**
 * Connector-owned defs that are the target of a child mapping (`parentMappingId` set):
 * they hold a parent's lines, so they are excluded like `line_item`.
 */
export async function readChildMappingDefIds(
  db: Database,
  organizationId: string,
  entityDefinitionIds: string[]
): Promise<Set<string>> {
  if (entityDefinitionIds.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ entityDefinitionId: schema.DataConnectorMapping.entityDefinitionId })
    .from(schema.DataConnectorMapping)
    .where(
      and(
        eq(schema.DataConnectorMapping.organizationId, organizationId),
        isNotNull(schema.DataConnectorMapping.parentMappingId),
        inArray(schema.DataConnectorMapping.entityDefinitionId, entityDefinitionIds)
      )
    )
  return new Set(rows.flatMap((r) => (r.entityDefinitionId ? [r.entityDefinitionId] : [])))
}

/** Every EntityDefinition id in the org whose live records count toward the records limit. */
export async function readMeteredDefIds(db: Database, organizationId: string): Promise<string[]> {
  const resources = await getCachedResources(organizationId)
  // Only connector-owned defs can be excluded, so most orgs skip the query entirely.
  const connectorOwned = resources.flatMap((r) =>
    r.type === 'custom' && r.metered && r.dataConnectorId ? [r.entityDefinitionId] : []
  )
  const childIds = await readChildMappingDefIds(db, organizationId, connectorOwned)
  return resources.filter((r) => isMeteredResource(r, childIds)).map((r) => r.entityDefinitionId)
}

/** Whether records of one def (id, entityType or apiSlug) count toward the records limit. */
export async function isMeteredDef(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<boolean> {
  const resource = await findCachedResource(organizationId, entityDefinitionId)
  if (!resource || resource.type !== 'custom' || !resource.metered) return false
  if (!resource.dataConnectorId) return true
  const childIds = await readChildMappingDefIds(db, organizationId, [resource.entityDefinitionId])
  return isMeteredResource(resource, childIds)
}
