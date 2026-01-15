// packages/types/field/utils.ts

import type { FieldId, ResourceFieldId } from './index'

/**
 * Create a FieldId from a string.
 * For custom fields: Pass the database UUID
 * For system fields: Pass the field key
 */
export function toFieldId(id: string): FieldId {
  return id as FieldId
}

/**
 * Create a ResourceFieldId from entityDefinitionId and fieldId.
 */
export function toResourceFieldId(
  entityDefinitionId: string,
  fieldId: FieldId | string,
): ResourceFieldId {
  return `${entityDefinitionId}:${fieldId}` as ResourceFieldId
}

/**
 * Parse a ResourceFieldId back to its components.
 */
export function parseResourceFieldId(resourceFieldId: ResourceFieldId): {
  entityDefinitionId: string
  fieldId: FieldId
} {
  const colonIndex = resourceFieldId.indexOf(':')
  if (colonIndex === -1) {
    console.error('[parseResourceFieldId] Malformed ResourceFieldId (missing colon):', resourceFieldId)
    return { entityDefinitionId: resourceFieldId, fieldId: '' as FieldId }
  }
  return {
    entityDefinitionId: resourceFieldId.slice(0, colonIndex),
    fieldId: resourceFieldId.slice(colonIndex + 1) as FieldId,
  }
}

/**
 * Type guard to check if a string is a valid ResourceFieldId format.
 */
export function isResourceFieldId(value: unknown): value is ResourceFieldId {
  return typeof value === 'string' && value.includes(':')
}

/**
 * Type guard to check if a string is a valid FieldId.
 */
export function isFieldId(value: unknown): value is FieldId {
  return typeof value === 'string' && value.length > 0
}

/**
 * Extract just the fieldId from a ResourceFieldId.
 */
export function getFieldId(resourceFieldId: ResourceFieldId): FieldId {
  return parseResourceFieldId(resourceFieldId).fieldId
}

/**
 * Extract just the entityDefinitionId from a ResourceFieldId.
 */
export function getFieldDefinitionId(resourceFieldId: ResourceFieldId): string {
  return parseResourceFieldId(resourceFieldId).entityDefinitionId
}

/**
 * Create ResourceFieldId[] from entityDefinitionId and array of field IDs.
 */
export function toResourceFieldIds(
  entityDefinitionId: string,
  fieldIds: (FieldId | string)[],
): ResourceFieldId[] {
  return fieldIds.map((id) => toResourceFieldId(entityDefinitionId, id))
}
