// apps/web/src/server/api/routers/table-view-helpers.ts

import { getCachedResources } from '@auxx/lib/cache'
import { resolveDefIdFromResources } from './table-view-structural'

export type { StructuralViewShape } from './table-view-structural'
export { isStructural, resolveDefIdFromResources } from './table-view-structural'

/**
 * Resolve the canonical `EntityDefinition.id` a `tableId` belongs to, or `null`
 * for non-entity surfaces. Reads the org's cached resources. Used to populate
 * `TableView.entityDefinitionId` on create and to key the def-admin gate.
 */
export async function resolveDefId(
  tableId: string,
  organizationId: string
): Promise<string | null> {
  const resources = await getCachedResources(organizationId)
  return resolveDefIdFromResources(tableId, resources)
}
