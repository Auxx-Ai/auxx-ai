// packages/lib/src/workflow-engine/resources/registry/relationship-utils.ts

import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import type { TableId } from './field-registry'
import type { ResourceField } from './field-types'
import type { FieldOptions } from '../../field-values/converters'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { BaseType } from '../types'

/**
 * Get all relationship fields for a table
 */
export function getRelationshipFields(tableId: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[tableId]
  if (!fields) return []

  return Object.values(fields).filter(
    (field) => field.type === BaseType.RELATION && field.relationship
  )
}

/**
 * Get relationship config for a field
 */
export function getRelationship(
  tableId: TableId,
  fieldKey: string
): FieldOptions['relationship'] | undefined {
  const field = RESOURCE_FIELD_REGISTRY[tableId]?.[fieldKey]
  return field?.relationship
}

/**
 * Check if field is a forward relationship (has dbColumn)
 */
export function isForwardRelationship(field: ResourceField): boolean {
  return field.type === BaseType.RELATION && !!field.dbColumn
}

/**
 * Check if field is a reverse relationship (no dbColumn)
 */
export function isReverseRelationship(field: ResourceField): boolean {
  return field.type === BaseType.RELATION && !field.dbColumn
}

/**
 * Get the database column for a relationship field
 * Returns undefined for reverse relationships
 */
export function getRelationshipDbColumn(tableId: TableId, fieldKey: string): string | undefined {
  const field = RESOURCE_FIELD_REGISTRY[tableId]?.[fieldKey]
  return field?.dbColumn
}

/**
 * Get target table for a relationship
 */
export function getTargetTable(tableId: TableId, fieldKey: string): TableId | undefined {
  const relationship = getRelationship(tableId, fieldKey)
  if (!relationship) return undefined
  return getRelatedEntityDefinitionId(relationship as RelationshipConfig) as TableId | undefined
}

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
 * Resolve a .referenceId path to its database column
 * E.g., 'ticket.contact.referenceId' → { table: 'ticket', column: 'contactId' }
 */
export function resolveReferenceIdPath(
  tableId: TableId,
  path: string
): { table: string; column: string } | null {
  // Path format: "fieldName.referenceId"
  const parts = path.split('.')
  if (parts.length !== 2 || parts[1] !== 'referenceId') {
    return null
  }

  const fieldKey = parts[0]!
  const field = RESOURCE_FIELD_REGISTRY[tableId]?.[fieldKey]

  if (!field || !field.dbColumn || !hasReferenceId(field)) {
    return null
  }

  return {
    table: tableId,
    column: field.dbColumn,
  }
}

/**
 * Create a relationship collection structure for has_many and many_to_many
 * Provides helper properties: values, count, isEmpty, first, last
 */
export function createRelationshipCollection(
  relatedResource: string,
  relationshipType: 'has_many' | 'many_to_many'
): Record<string, any> {
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

/**
 * Get relationship metadata from a variable's reference property
 * Parses the reference (e.g., "ticket:contact") and fetches from registry
 */
export function getRelationshipFromVariable(variable: {
  reference?: string
}): { field: ResourceField; tableId: string; fieldKey: string } | null {
  if (!variable.reference) return null

  // Parse reference format: "tableId:fieldKey"
  const parts = variable.reference.split(':')
  if (parts.length !== 2) return null

  const [tableId, fieldKey] = parts
  const field = RESOURCE_FIELD_REGISTRY[tableId as TableId]?.[fieldKey!]

  if (!field || field.type !== BaseType.RELATION) return null

  return {
    field,
    tableId: tableId!,
    fieldKey: fieldKey!,
  }
}

/**
 * Check if a variable represents a relationship field
 */
export function isRelationshipVariable(variable: { reference?: string }): boolean {
  if (!variable.reference) return false

  const relationshipInfo = getRelationshipFromVariable(variable)
  return !!relationshipInfo
}
