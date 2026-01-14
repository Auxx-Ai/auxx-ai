// packages/lib/src/import/fields/get-identifiable-fields.ts

import type { Resource } from '../../resources/registry/types'
import type { ImportableField } from './get-importable-fields'

/** Fields commonly used as unique identifiers */
const IDENTIFIER_FIELD_KEYS = new Set(['id', 'externalId'])

/**
 * Get fields that can identify records for update operations.
 * These are filterable fields that can uniquely identify a record.
 * Includes:
 * - System fields marked as identifiers (id, externalId)
 * - Custom fields marked with isUnique=true (via isIdentifier)
 *
 * @param resource - Resource definition
 * @returns Array of identifier fields
 */
export function getIdentifiableFields(resource: Resource): ImportableField[] {
  return resource.fields
    .filter((field) => {
      // Must be filterable for lookups
      if (!field.capabilities.filterable) return false
      // Skip relation fields (except has_one which could be unique)
      if (field.relationship && field.relationship.relationshipType !== 'has_one') return false
      // Include if explicitly marked as identifier (system or unique custom field)
      if (field.isIdentifier) return true
      // Include known system identifier fields
      return IDENTIFIER_FIELD_KEYS.has(field.key)
    })
    .map((field) => ({
      key: field.key,
      id: field.id,
      label: field.key === 'id' ? 'Record ID' : field.label,
      type: field.type,
      required: false,
      isRelation: !!field.relationship,
      isIdentifier: true,
      group: 'identifier' as const,
    }))
}
