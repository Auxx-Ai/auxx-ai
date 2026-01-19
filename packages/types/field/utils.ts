// packages/types/field/utils.ts

import type { FieldId, ResourceFieldId, FieldPath, FieldReference } from './index'

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

/**
 * Create a field path from ResourceFieldId array.
 * @throws Error if array is empty
 */
export function toFieldPath(resourceFieldIds: ResourceFieldId[]): FieldPath {
  if (resourceFieldIds.length === 0) {
    throw new Error('Field path cannot be empty')
  }
  return resourceFieldIds as FieldPath
}

/**
 * Check if a field reference is a path (vs direct field).
 */
export function isFieldPath(ref: FieldReference): ref is FieldPath {
  return Array.isArray(ref)
}

/**
 * Validate that a field path is correctly chained.
 * Checks that each step's related entity matches the next step's entity.
 *
 * @example
 * // Valid path: product:vendor → vendor:name
 * validateFieldPath(
 *   ['product:vendor', 'vendor:name'],
 *   { 'product:vendor': { relatedEntityDefinitionId: 'vendor' } }
 * ) // ✓ Returns true
 *
 * // Invalid path: product:vendor → customer:name (mismatch)
 * validateFieldPath(
 *   ['product:vendor', 'customer:name'],
 *   { 'product:vendor': { relatedEntityDefinitionId: 'vendor' } }
 * ) // ✗ Returns false
 */
export function validateFieldPath(
  path: FieldPath,
  fieldMetadata: Record<ResourceFieldId, { relatedEntityDefinitionId?: string }>,
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const currentResourceFieldId = path[i]
    const nextResourceFieldId = path[i + 1]

    // Get related entity from current field
    const relatedEntityId = fieldMetadata[currentResourceFieldId]?.relatedEntityDefinitionId
    if (!relatedEntityId) {
      return false
    }

    // Check that next field's entity matches
    const nextEntityId = getFieldDefinitionId(nextResourceFieldId)
    if (relatedEntityId !== nextEntityId) {
      return false
    }
  }

  return true
}

/**
 * Convert field path to human-readable string.
 * ["product:vendor", "vendor:name"] → "vendor → name"
 */
export function fieldPathToString(path: FieldPath): string {
  return path.map((rfId) => getFieldId(rfId)).join(' → ')
}

/**
 * Get the root entity definition ID from a field path.
 * ["product:vendor", "vendor:name"] → "product"
 */
export function getRootEntityId(path: FieldPath): string {
  return getFieldDefinitionId(path[0])
}

/**
 * Get the target field ID from a field path (last element).
 * ["product:vendor", "vendor:name"] → "name"
 */
export function getTargetFieldId(path: FieldPath): FieldId {
  return getFieldId(path[path.length - 1])
}

/**
 * Convert a FieldReference to a string key for Maps/caching.
 * - ResourceFieldId: "vendor:name" → "vendor:name"
 * - FieldPath: ["product:vendor", "vendor:name"] → "product:vendor::vendor:name"
 */
export function fieldRefToKey(ref: FieldReference): string {
  return isFieldPath(ref) ? ref.join('::') : ref
}

/**
 * Parse a fieldRefKey back to a FieldReference.
 * Inverse of fieldRefToKey.
 *
 * @example
 * keyToFieldRef("contact:email") // => "contact:email" (ResourceFieldId)
 * keyToFieldRef("product:vendor::vendor:name") // => ["product:vendor", "vendor:name"] (FieldPath)
 */
export function keyToFieldRef(key: string): FieldReference {
  if (key.includes('::')) {
    return key.split('::') as FieldPath
  }
  return key as ResourceFieldId
}

/**
 * Check if a field reference is a plain FieldId (needs resolution).
 *
 * Detection logic:
 * - Array → FieldPath
 * - String with ':' → ResourceFieldId
 * - String without ':' → FieldId
 *
 * This is a pure type guard with no external dependencies.
 */
export function isPlainFieldId(ref: FieldReference): ref is FieldId {
  return typeof ref === 'string' && !ref.includes(':')
}
