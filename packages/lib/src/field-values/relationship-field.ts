// packages/lib/src/field-values/relationship-field.ts

import type { RelationshipFieldValue, RelationshipFieldValueInput, TypedFieldValue } from '@auxx/types/field-value'
import type { ResourceRef } from '@auxx/types/resource'

/**
 * Extracted relationship data with ResourceRefs ready for useRelationship
 */
export interface RelationshipData {
  /** ResourceRef[] ready for direct use with useRelationship */
  references: ResourceRef[]
  /** Unique entity definition IDs found in the value (for mixed-type relationships) */
  entityDefinitionIds: string[]
}

/** Valid relationship cardinality types */
export type RelationshipType = 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'

// ============================================================================
// TYPE GUARDS - Narrow and validate relationship values
// ============================================================================

/** Check if value is a RelationshipFieldValue object */
export function isRelationshipFieldValue(v: unknown): v is RelationshipFieldValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'relatedEntityId' in v &&
    'type' in v &&
    (v as any).type === 'relationship'
  )
}

/** Check if value is an array of RelationshipFieldValue objects */
export function isRelationshipFieldValueArray(v: unknown): v is RelationshipFieldValue[] {
  return Array.isArray(v) && v.every(isRelationshipFieldValue)
}

// ============================================================================
// EXTRACTORS - Get data from any input format
// ============================================================================

/**
 * Extract ResourceRefs and entityDefinitionIds from ANY relationship value format.
 * Handles: objects, arrays, strings, null, undefined.
 *
 * @returns { references, entityDefinitionIds } - ready for useRelationship
 *
 * @example
 * const { references } = extractRelationshipData(value)
 * const { items } = useRelationship(references)
 */
export function extractRelationshipData(value: unknown): RelationshipData {
  if (!value) {
    return { references: [], entityDefinitionIds: [] }
  }

  const references: ResourceRef[] = []
  const entityDefinitionIdSet = new Set<string>()

  // Array of full objects or IDs
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'object' && item !== null && 'relatedEntityId' in item) {
        const rel = item as RelationshipFieldValue
        const entityDefId = rel.relatedEntityDefinitionId
        if (entityDefId && rel.relatedEntityId) {
          references.push({
            entityDefinitionId: entityDefId,
            entityInstanceId: rel.relatedEntityId,
          })
          entityDefinitionIdSet.add(entityDefId)
        }
      }
      // Skip raw string IDs - we need entityDefinitionId to create valid ResourceRef
    }

    return {
      references,
      entityDefinitionIds: Array.from(entityDefinitionIdSet),
    }
  }

  // Single object with relatedEntityId
  if (typeof value === 'object' && 'relatedEntityId' in value) {
    const rel = value as RelationshipFieldValue
    const entityDefId = rel.relatedEntityDefinitionId
    if (entityDefId && rel.relatedEntityId) {
      return {
        references: [
          {
            entityDefinitionId: entityDefId,
            entityInstanceId: rel.relatedEntityId,
          },
        ],
        entityDefinitionIds: [entityDefId],
      }
    }
  }

  // Raw ID string or invalid format - cannot create ResourceRef without entityDefinitionId
  return { references: [], entityDefinitionIds: [] }
}

// ============================================================================
// NORMALIZERS - Convert all formats to standard RelationshipFieldValue[]
// ============================================================================

/**
 * Normalize relationship value to always return RelationshipFieldValue[].
 * This is the core function that eliminates single vs. array branching.
 *
 * Examples:
 * - null → []
 * - "id-123" → [{ relatedEntityId: "id-123", relatedEntityDefinitionId: "", ... }]
 * - { relatedEntityId: "id-123" } → [{ relatedEntityId: "id-123", ... }]
 * - [{ relatedEntityId: "a" }, { relatedEntityId: "b" }] → [both items as is]
 */
export function normalizeRelationshipValue(value: unknown): RelationshipFieldValue[] {
  if (!value) {
    return []
  }

  // Already an array of proper objects
  if (isRelationshipFieldValueArray(value)) {
    return value
  }

  // Single RelationshipFieldValue object
  if (isRelationshipFieldValue(value)) {
    return [value]
  }

  // Array of mixed types (objects or strings)
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isRelationshipFieldValue(item)) {
          return item
        }
        if (typeof item === 'string') {
          return {
            type: 'relationship' as const,
            relatedEntityId: item,
            relatedEntityDefinitionId: '',
            entityId: '',
            fieldId: '',
            id: '',
            sortKey: '',
            createdAt: '',
            updatedAt: '',
          } as RelationshipFieldValue
        }
        return null
      })
      .filter((item): item is RelationshipFieldValue => item !== null)
  }

  // Single string ID
  if (typeof value === 'string') {
    return [
      {
        type: 'relationship' as const,
        relatedEntityId: value,
        relatedEntityDefinitionId: '',
        entityId: '',
        fieldId: '',
        id: '',
        sortKey: '',
        createdAt: '',
        updatedAt: '',
      } as RelationshipFieldValue,
    ]
  }

  // Fallback: return empty array
  return []
}

// ============================================================================
// CONVERTERS - For mutation inputs (no id/timestamps)
// ============================================================================

/**
 * Convert raw value to RelationshipFieldValueInput for mutations.
 * Used by relationshipConverter in converters/relationship.ts.
 */
export function convertRawToRelationshipInput(
  obj: unknown
): RelationshipFieldValueInput | RelationshipFieldValueInput[] | null {
  if (!obj) return null

  // Array of values
  if (Array.isArray(obj)) {
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null && 'relatedEntityId' in item) {
          const rel = item as { relatedEntityId: string; relatedEntityDefinitionId?: string }
          return {
            type: 'relationship' as const,
            relatedEntityId: rel.relatedEntityId,
            relatedEntityDefinitionId: rel.relatedEntityDefinitionId ?? '',
          }
        }
        return { type: 'relationship' as const, relatedEntityId: String(item), relatedEntityDefinitionId: '' }
      })
      .filter((item) => item.relatedEntityId)
  }

  // Single object
  if (typeof obj === 'object' && 'relatedEntityId' in obj) {
    const rel = obj as { relatedEntityId: string; relatedEntityDefinitionId?: string }
    return {
      type: 'relationship' as const,
      relatedEntityId: rel.relatedEntityId,
      relatedEntityDefinitionId: rel.relatedEntityDefinitionId ?? '',
    }
  }

  // Single string ID
  if (typeof obj === 'string' && obj.trim()) {
    return {
      type: 'relationship' as const,
      relatedEntityId: obj.trim(),
      relatedEntityDefinitionId: '',
    }
  }

  return null
}

// ============================================================================
// VALIDATORS - Ensure data integrity
// ============================================================================

/**
 * Validate that a value is a valid relationship value.
 * Checks structure and required fields.
 */
export function validateRelationshipValue(value: unknown): boolean {
  // Accept null/undefined as valid (empty relationship)
  if (!value) return true

  // Array of values
  if (Array.isArray(value)) {
    return value.every((item) => {
      if (typeof item === 'string' && item.trim()) return true
      if (typeof item === 'object' && item !== null && 'relatedEntityId' in item) {
        return typeof (item as any).relatedEntityId === 'string' && (item as any).relatedEntityId.trim()
      }
      return false
    })
  }

  // Single string or object
  if (typeof value === 'string' && value.trim()) return true
  if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
    return typeof (value as any).relatedEntityId === 'string' && (value as any).relatedEntityId.trim()
  }

  return false
}

/**
 * Validate that entityDefinitionId is present and non-empty.
 * Use after extraction to ensure relationships are properly typed.
 */
export function validateEntityDefinitionId(entityDefinitionId: string | null): boolean {
  return typeof entityDefinitionId === 'string' && entityDefinitionId.trim().length > 0
}

// ============================================================================
// RESOURCE REF EXTRACTORS - For useRelationship hook
// ============================================================================

/**
 * Extract ResourceRef[] from ANY relationship value format.
 * Convenience wrapper around extractRelationshipData(value).references
 */
export function extractRelationshipRefs(value: unknown): ResourceRef[] {
  return extractRelationshipData(value).references
}

// ============================================================================
// RELATIONSHIP HELPERS - Canonical utilities for relationship handling
// ============================================================================

/**
 * Determine if a relationship type allows multiple selections.
 *
 * @param relationshipType - The relationship cardinality type
 * @returns true if has_many or many_to_many, false for belongs_to/has_one/undefined
 *
 * @example
 * const multi = isMultiRelationship(field.options?.relationship?.relationshipType)
 */
export function isMultiRelationship(relationshipType?: RelationshipType | string): boolean {
  return relationshipType === 'has_many' || relationshipType === 'many_to_many'
}

/**
 * Create a single ResourceRef from entityDefinitionId and entityInstanceId.
 *
 * @example
 * const ref = toResourceRef('ticket', ticketId)
 */
export function toResourceRef(entityDefinitionId: string, entityInstanceId: string): ResourceRef {
  return { entityDefinitionId, entityInstanceId }
}

/**
 * Create ResourceRef[] from entityDefinitionId and array of IDs.
 *
 * @example
 * const refs = toResourceRefs('contact', ['id1', 'id2'])
 */
export function toResourceRefs(entityDefinitionId: string, ids: string[]): ResourceRef[] {
  return ids.map((id) => ({ entityDefinitionId, entityInstanceId: id }))
}

/**
 * Create ResourceRef[] from entityDefinitionId and optional single ID.
 * Returns empty array if id is falsy.
 *
 * @example
 * const refs = toResourceRefsFromId('ticket', selectedTicketId)
 * // selectedTicketId = 'abc' → [{ entityDefinitionId: 'ticket', entityInstanceId: 'abc' }]
 * // selectedTicketId = null → []
 */
export function toResourceRefsFromId(
  entityDefinitionId: string,
  id: string | null | undefined
): ResourceRef[] {
  return id ? [{ entityDefinitionId, entityInstanceId: id }] : []
}
