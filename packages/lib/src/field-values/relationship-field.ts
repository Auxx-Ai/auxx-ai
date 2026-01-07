// packages/lib/src/field-values/relationship-field.ts

import type { RelationshipFieldValue, RelationshipFieldValueInput, TypedFieldValue } from '@auxx/types/field-value'

/** Extracted relationship data - always normalized to arrays */
export interface RelationshipData {
  ids: string[]
  entityDefinitionId: string | null
}

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
 * Extract IDs and entityDefinitionId from ANY format.
 * Handles: objects, arrays, strings, null, undefined.
 * ALWAYS returns an object with arrays (never null/undefined).
 */
export function extractRelationshipData(value: unknown): RelationshipData {
  if (!value) {
    return { ids: [], entityDefinitionId: null }
  }

  // Array of full objects or IDs
  if (Array.isArray(value)) {
    const ids: string[] = []
    let entityDefinitionId: string | null = null

    for (const item of value) {
      if (typeof item === 'object' && item !== null && 'relatedEntityId' in item) {
        const rel = item as RelationshipFieldValue
        ids.push(rel.relatedEntityId)
        if (!entityDefinitionId) entityDefinitionId = rel.relatedEntityDefinitionId || null
      } else if (typeof item === 'string') {
        ids.push(item)
      }
    }

    return { ids, entityDefinitionId }
  }

  // Single object with relatedEntityId
  if (typeof value === 'object' && 'relatedEntityId' in value) {
    const rel = value as RelationshipFieldValue
    return {
      ids: [rel.relatedEntityId],
      entityDefinitionId: rel.relatedEntityDefinitionId || null,
    }
  }

  // Raw ID string
  return { ids: [String(value)], entityDefinitionId: null }
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
