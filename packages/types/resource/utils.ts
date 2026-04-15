// packages/types/resource/utils.ts

import { type ModelType, ModelTypeValues } from '@auxx/database/enums'
import type { RecordId } from './index'

/**
 * Create a RecordId from entityDefinitionId and entityInstanceId.
 */
export function toRecordId(entityDefinitionId: string, entityInstanceId: string): RecordId {
  return `${entityDefinitionId}:${entityInstanceId}` as RecordId
}

/**
 * Parse a RecordId back to its components.
 */
export function parseRecordId(recordId: RecordId): {
  entityDefinitionId: string
  entityInstanceId: string
} {
  // Defensive check for undefined/null
  if (!recordId) {
    console.error('[parseRecordId] RecordId is undefined or null:', recordId)
    return { entityDefinitionId: '', entityInstanceId: '' }
  }

  const colonIndex = recordId.indexOf(':')
  if (colonIndex === -1) {
    console.error('[parseRecordId] Malformed RecordId (missing colon):', recordId)
    return { entityDefinitionId: recordId, entityInstanceId: '' }
  }
  return {
    entityDefinitionId: recordId.slice(0, colonIndex),
    entityInstanceId: recordId.slice(colonIndex + 1),
  }
}

/**
 * Type guard to check if a string is a valid RecordId format.
 */
export function isRecordId(value: unknown): value is RecordId {
  return typeof value === 'string' && value.includes(':')
}

/**
 * Create RecordId[] from entityDefinitionId and array of instance IDs.
 */
export function toRecordIds(entityDefinitionId: string, instanceIds: string[]): RecordId[] {
  return instanceIds.map((id) => toRecordId(entityDefinitionId, id))
}

/**
 * Extract just the entityInstanceId from a RecordId.
 */
export function getInstanceId(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/**
 * Extract just the entityDefinitionId from a RecordId.
 */
export function getDefinitionId(recordId: RecordId): string {
  return parseRecordId(recordId).entityDefinitionId
}

/**
 * Normalize a value to RecordId format.
 * Handles the various shapes that can represent a related entity:
 * - RecordId string ("entityDefId:instanceId") → pass through
 * - Plain string ID ("abc123") → toRecordId(fallbackEntityDefId, id)
 * - Entity object ({ id, entityDefinitionId }) → toRecordId(obj.entityDefinitionId, obj.id)
 * - ResourceReference ({ __resourceRef, resourceId, resourceType }) → toRecordId(resourceType, resourceId)
 * - TypedFieldValue ({ relatedEntityId, relatedEntityDefinitionId }) → toRecordId(defId, entityId)
 *
 * @param value - The value to normalize
 * @param fallbackEntityDefId - Entity definition ID to use when the value doesn't carry one
 * @returns RecordId or null if value cannot be normalized
 */
export function normalizeToRecordId(value: unknown, fallbackEntityDefId: string): RecordId | null {
  if (!value) return null

  // String values
  if (typeof value === 'string') {
    if (value.includes(':')) return value as RecordId
    return toRecordId(fallbackEntityDefId, value)
  }

  // Object values
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, any>

    // ResourceReference: { __resourceRef: true, resourceId, resourceType }
    if (obj.__resourceRef && obj.resourceId) {
      return toRecordId(obj.resourceType ?? fallbackEntityDefId, obj.resourceId)
    }

    // TypedFieldValue: { relatedEntityId, relatedEntityDefinitionId }
    if (obj.relatedEntityId) {
      return toRecordId(obj.relatedEntityDefinitionId ?? fallbackEntityDefId, obj.relatedEntityId)
    }

    // Entity object: { id, entityDefinitionId }
    if (obj.id) {
      return toRecordId(obj.entityDefinitionId ?? fallbackEntityDefId, obj.id)
    }
  }

  return null
}

/**
 * Normalize an array of values to RecordId[].
 * Filters out any values that cannot be normalized.
 */
export function normalizeToRecordIds(values: unknown[], fallbackEntityDefId: string): RecordId[] {
  const result: RecordId[] = []
  for (const v of values) {
    const recordId = normalizeToRecordId(v, fallbackEntityDefId)
    if (recordId) result.push(recordId)
  }
  return result
}

/**
 * System entity types that are stored in the EntityDefinition table.
 * Each org gets one EntityDefinition row per type with entityType set.
 * Custom (user-created) entities also use EntityDefinition but with entityType = null.
 */
export const ENTITY_DEFINITION_TYPES = [
  'contact',
  'entity_group',
  'inbox',
  'part',
  'signature',
  'subpart',
  'tag',
  'ticket',
  'vendor_part',
  'stock_movement',
  'company',
  'meeting',
] as const

/** Type for system entity types stored in EntityDefinition */
export type EntityDefinitionType = (typeof ENTITY_DEFINITION_TYPES)[number]

/**
 * Check if a string is a system type stored in EntityDefinition.
 */
export function isEntityDefinitionType(type: string): type is EntityDefinitionType {
  return (ENTITY_DEFINITION_TYPES as readonly string[]).includes(type)
}

/**
 * Check if an entityDefinitionId is a system ModelType.
 */
export function isSystemModelType(entityDefinitionId: string): entityDefinitionId is ModelType {
  return (ModelTypeValues as readonly string[]).includes(entityDefinitionId)
}

/**
 * Derive ModelType from entityDefinitionId.
 * If entityDefinitionId is a known system ModelType, return it.
 * Otherwise (custom entity UUID), return 'entity'.
 */
export function getModelType(entityDefinitionId: string): ModelType {
  return isSystemModelType(entityDefinitionId) ? entityDefinitionId : 'entity'
}
