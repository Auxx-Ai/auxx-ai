// apps/web/src/components/dynamic-table/utils/column-id.ts

import type { FieldPath, ResourceFieldId } from '@auxx/types/field'

/**
 * Decoded column ID representing a direct field.
 */
export interface DecodedDirectField {
  type: 'direct'
  resourceFieldId: ResourceFieldId
}

/**
 * Decoded column ID representing a field path (relationship traversal).
 */
export interface DecodedFieldPath {
  type: 'path'
  fieldPath: FieldPath
}

/**
 * Union type for decoded column IDs.
 */
export type DecodedColumnId = DecodedDirectField | DecodedFieldPath

/**
 * Decode a column ID to extract field information.
 * Pattern-based detection:
 * - Contains '::' → Field path (multiple ResourceFieldIds)
 * - Otherwise → Direct field (single ResourceFieldId)
 *
 * @param columnId - The column ID to decode
 * @returns Decoded field information
 *
 * @example
 * decodeColumnId('contact:email')
 * // => { type: 'direct', resourceFieldId: 'contact:email' }
 *
 * @example
 * decodeColumnId('product:vendor::vendor:name')
 * // => { type: 'path', fieldPath: ['product:vendor', 'vendor:name'] }
 */
export function decodeColumnId(columnId: string): DecodedColumnId {
  // Contains :: separator → field path
  if (columnId.includes('::')) {
    const fieldPath = columnId.split('::') as FieldPath
    return {
      type: 'path',
      fieldPath,
    }
  }

  // Single segment → direct field
  return {
    type: 'direct',
    resourceFieldId: columnId as ResourceFieldId,
  }
}

/**
 * Encode a ResourceFieldId into a column ID.
 * No transformation needed - use as-is.
 */
export function encodeDirectFieldColumnId(resourceFieldId: ResourceFieldId): string {
  return resourceFieldId
}

/**
 * Encode a field path into a column ID.
 * Join with :: separator.
 */
export function encodeFieldPathColumnId(fieldPath: FieldPath): string {
  return fieldPath.join('::')
}

/**
 * Check if a column ID represents a field path.
 */
export function isFieldPathColumnId(columnId: string): boolean {
  return columnId.includes('::')
}

/**
 * Check if a column ID represents a direct field.
 */
export function isDirectFieldColumnId(columnId: string): boolean {
  return !columnId.includes('::')
}

/**
 * Check if a column ID represents a field (direct or path).
 * Field columns contain a colon in entity:field format.
 * Special columns like '_checkbox' don't have colons.
 */
export function isFieldColumnId(columnId: string): boolean {
  return columnId.includes(':')
}
