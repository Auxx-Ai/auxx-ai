// packages/lib/src/import/fields/get-identifiable-fields.ts

import { getFieldOutputKey } from '../../resources/registry/field-types'
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
      // Hidden fields are invisible to users — never offer them as identifiers
      if (field.capabilities.hidden) return false
      // Must be filterable for lookups
      if (!field.capabilities.filterable) return false
      // Skip relation fields (except has_one which could be unique)
      if (field.relationship && field.relationship.relationshipType !== 'has_one') return false
      // Include if explicitly marked as identifier (system or unique custom field)
      if (field.isIdentifier) return true
      // Include known system identifier fields
      const outputKey = getFieldOutputKey(field)
      return IDENTIFIER_FIELD_KEYS.has(outputKey)
    })
    .map((field) => {
      const isCustomField = !field.isSystem
      const outputKey = getFieldOutputKey(field)
      return {
        key: outputKey,
        id: isCustomField ? field.id : undefined,
        label: outputKey === 'id' ? 'Record ID' : field.label,
        type: field.type,
        required: false,
        isRelation: !!field.relationship,
        isIdentifier: true,
        group: 'identifier' as const,
      }
    })
}
