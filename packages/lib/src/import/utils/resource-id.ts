// packages/lib/src/import/utils/resource-id.ts

import { type RecordId, toRecordId } from '@auxx/types/resource'

/**
 * Build a RecordId from an import context.
 * Handles both system resources (contact, ticket) and custom entities (UUID).
 *
 * @param entityDefinitionId - Entity definition ID (e.g., 'contact' or UUID for custom entity)
 * @param instanceId - Instance ID of the record
 * @returns Full RecordId in format 'entityDefinitionId:instanceId'
 */
export function buildImportRecordId(entityDefinitionId: string, instanceId: string): RecordId {
  return toRecordId(entityDefinitionId, instanceId)
}

/**
 * Build RecordIds for a batch of instance IDs.
 *
 * @param entityDefinitionId - Entity definition ID (shared by all instances)
 * @param instanceIds - Array of instance IDs
 * @returns Array of RecordIds
 */
export function buildImportRecordIds(
  entityDefinitionId: string,
  instanceIds: string[]
): RecordId[] {
  return instanceIds.map((id) => toRecordId(entityDefinitionId, id))
}
