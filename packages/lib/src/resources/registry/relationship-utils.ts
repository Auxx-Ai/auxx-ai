// packages/lib/src/workflow-engine/resources/registry/relationship-utils.ts

import type { ResourceField } from './field-types'
import { BaseType } from '../types'

/**
 * Check if relationship has .referenceId accessor
 * (Only belongs_to and has_one relationships)
 */
export function hasReferenceId(field: ResourceField): boolean {
  if (field.type !== BaseType.RELATION || !field.relationship) return false

  const type = field.relationship.relationshipType
  return type === 'belongs_to' || type === 'has_one'
}

/**
 * Create a relationship collection structure for has_many and many_to_many
 * Provides helper properties: values, count, isEmpty, first, last
 */
export function createRelationshipCollection(relatedResource: string): Record<string, any> {
  return {
    // Core array of items
    values: {
      type: 'array',
      label: `${relatedResource} list`,
      description: `Array of ${relatedResource} records`,
    },

    // Helper: Count of items
    count: {
      type: 'number',
      label: 'Count',
      description: `Number of ${relatedResource} records`,
      computed: true, // This is computed from values.length at runtime
    },

    // Helper: Is collection empty
    isEmpty: {
      type: 'boolean',
      label: 'Is Empty',
      description: `Whether there are any ${relatedResource} records`,
      computed: true, // This is computed from values.length === 0 at runtime
    },

    // Helper: First item (or null)
    first: {
      type: 'object',
      label: 'First',
      description: `First ${relatedResource} record (or null if empty)`,
      nullable: true,
      computed: true, // This is computed from values[0] at runtime
    },

    // Helper: Last item (or null)
    last: {
      type: 'object',
      label: 'Last',
      description: `Last ${relatedResource} record (or null if empty)`,
      nullable: true,
      computed: true, // This is computed from values[values.length - 1] at runtime
    },
  }
}
