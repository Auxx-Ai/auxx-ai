// packages/lib/src/resources/registry/trailing-fields.ts

import type { ResourceField } from './field-types'

/** Keys of metadata fields that should appear after business fields */
export const TRAILING_FIELD_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'created_by_id'])

/**
 * Is `field` one of the trailing metadata fields (id, createdAt, updatedAt, created_by_id)?
 * Matches on the field key or its system attribute. Used to keep metadata pinned to the end
 * of a field list — both when sorting and when anchoring a newly added field.
 */
export function isTrailingMetadataField(
  field: Pick<ResourceField, 'key' | 'systemAttribute'>
): boolean {
  return TRAILING_FIELD_KEYS.has(field.key) || TRAILING_FIELD_KEYS.has(field.systemAttribute ?? '')
}
