// packages/lib/src/import/utils/resource-id.ts

import { toResourceId, type ResourceId } from '@auxx/types/resource'

/**
 * Build a ResourceId from an import context.
 * Handles both system resources (contact, ticket) and custom entities (UUID).
 *
 * @param entityDefinitionId - Entity definition ID (e.g., 'contact' or UUID for custom entity)
 * @param instanceId - Instance ID of the record
 * @returns Full ResourceId in format 'entityDefinitionId:instanceId'
 */
export function buildImportResourceId(entityDefinitionId: string, instanceId: string): ResourceId {
  return toResourceId(entityDefinitionId, instanceId)
}

/**
 * Build ResourceIds for a batch of instance IDs.
 *
 * @param entityDefinitionId - Entity definition ID (shared by all instances)
 * @param instanceIds - Array of instance IDs
 * @returns Array of ResourceIds
 */
export function buildImportResourceIds(
  entityDefinitionId: string,
  instanceIds: string[]
): ResourceId[] {
  return instanceIds.map((id) => toResourceId(entityDefinitionId, id))
}
