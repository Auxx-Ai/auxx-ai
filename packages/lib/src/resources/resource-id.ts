// packages/lib/src/resources/resource-id.ts

import type { ResourceId } from '@auxx/types/resource'

/**
 * Create a ResourceId from entityDefinitionId and entityInstanceId.
 */
export function toResourceId(entityDefinitionId: string, entityInstanceId: string): ResourceId {
  return `${entityDefinitionId}:${entityInstanceId}` as ResourceId
}

/**
 * Parse a ResourceId back to its components.
 */
export function parseResourceId(resourceId: ResourceId): {
  entityDefinitionId: string
  entityInstanceId: string
} {
  const colonIndex = resourceId.indexOf(':')
  if (colonIndex === -1) {
    console.error('[parseResourceId] Malformed ResourceId (missing colon):', resourceId)
    return { entityDefinitionId: resourceId, entityInstanceId: '' }
  }
  return {
    entityDefinitionId: resourceId.slice(0, colonIndex),
    entityInstanceId: resourceId.slice(colonIndex + 1),
  }
}

/**
 * Type guard to check if a string is a valid ResourceId format.
 */
export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === 'string' && value.includes(':')
}

/**
 * Create ResourceId[] from entityDefinitionId and array of instance IDs.
 */
export function toResourceIds(entityDefinitionId: string, instanceIds: string[]): ResourceId[] {
  return instanceIds.map((id) => toResourceId(entityDefinitionId, id))
}

/**
 * Extract just the entityInstanceId from a ResourceId.
 */
export function getInstanceId(resourceId: ResourceId): string {
  return parseResourceId(resourceId).entityInstanceId
}

/**
 * Extract just the entityDefinitionId from a ResourceId.
 */
export function getDefinitionId(resourceId: ResourceId): string {
  return parseResourceId(resourceId).entityDefinitionId
}
