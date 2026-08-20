// apps/web/src/components/dynamic-table/utils/column-id.ts

import type { ResourceField } from '@auxx/lib/resources/client'
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

/**
 * Resolve the {@link ResourceField} a table column renders, for BOTH the
 * display consumers (cell formatting, copy-to-clipboard) and the edit
 * consumers (cell editors, paste, fill-drag) behind `getFieldDefinition`.
 *
 * A **path** column resolves to its TERMINAL field — the display side needs
 * that field's `fieldType`/`options` to format the cell — but is returned with
 * `capabilities.updatable: false`, because a path is a traversal, not a cell:
 *
 * 1. Its value is an aggregate over the 0..N related records the path reaches
 *    (`mapResultsToSources` returns an array as soon as a hop fans out), so
 *    there is nothing single-valued for an editor to bind to.
 * 2. Its write target — if one existed — would be the RELATED record, never the
 *    row the column is rendered on. Handing the terminal field to an editor
 *    keyed by THIS row's RecordId is what produced
 *    `Field "<relatedField>" not found in "<thisDef>"`: `PropertyProvider`
 *    fetches by the bare `field.id`, and `normalizeFieldRef` then qualifies it
 *    with the row's definition, fabricating a pair that cannot exist.
 *
 * Every consumer already honours `capabilities.updatable`, so the flag alone
 * keeps editors from mounting (`selectable-table-cell`) and keeps paste /
 * fill-drag writes filtered out (`saveCells`).
 *
 * @param fieldMap - `resourceStore.fieldMap`, keyed by canonical ResourceFieldId
 * @param columnId - Column ID (direct ResourceFieldId, encoded path, or special)
 * @returns The field, or `null` for special columns and unknown refs
 */
export function resolveColumnField(
  fieldMap: Record<ResourceFieldId, ResourceField>,
  columnId: string
): ResourceField | null {
  if (columnId.startsWith('_')) return null

  const decoded = decodeColumnId(columnId)

  if (decoded.type === 'path') {
    // FieldPath is a non-empty tuple; `[0]` is the guaranteed fallback.
    const terminal = decoded.fieldPath.at(-1) ?? decoded.fieldPath[0]
    const field = fieldMap[terminal]
    if (!field) return null
    if (field.capabilities.updatable === false) return field
    return { ...field, capabilities: { ...field.capabilities, updatable: false } }
  }

  return fieldMap[decoded.resourceFieldId] ?? null
}
