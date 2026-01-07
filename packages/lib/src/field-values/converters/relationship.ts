// packages/lib/src/field-values/converters/relationship.ts

import type { TypedFieldValueInput, TypedFieldValue, RelationshipFieldValue } from '@auxx/types/field-value'
import type { FieldValueConverter, ConverterOptions } from './index'

/**
 * Relationship value structure used for raw values.
 * Contains both the entity ID and the definition ID.
 */
export interface RelationshipRawValue {
  relatedEntityId: string
  relatedEntityDefinitionId: string
}

/**
 * Converter for RELATIONSHIP field type.
 * Stores as relatedEntityId + relatedEntityDefinitionId in the database.
 *
 * NOTE: toDisplayValue returns an object (not a string) because
 * display data (names, avatars) must be fetched on the frontend
 * using the useRelationship hook.
 */
export const relationshipConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts relationship object, raw ID string, or null/undefined.
   */
  toTypedInput(value: unknown, options?: ConverterOptions): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'relationship') {
        const rel = typed as RelationshipFieldValue
        if (!rel.relatedEntityId) return null
        return {
          type: 'relationship',
          relatedEntityId: rel.relatedEntityId,
          relatedEntityDefinitionId: rel.relatedEntityDefinitionId || options?.relatedEntityDefinitionId || '',
        }
      }
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // Handle object with relatedEntityId (raw relationship object)
    if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
      const rel = value as { relatedEntityId: string; relatedEntityDefinitionId?: string }
      if (!rel.relatedEntityId) return null
      return {
        type: 'relationship',
        relatedEntityId: rel.relatedEntityId,
        relatedEntityDefinitionId: rel.relatedEntityDefinitionId || options?.relatedEntityDefinitionId || '',
      }
    }

    // Handle raw ID string (use provided relatedEntityDefinitionId from options)
    if (typeof value === 'string') {
      return {
        type: 'relationship',
        relatedEntityId: value.trim(),
        relatedEntityDefinitionId: options?.relatedEntityDefinitionId || '',
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw relationship object.
   * Preserves both relatedEntityId and relatedEntityDefinitionId.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): RelationshipRawValue | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput with type discriminator
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'relationship') {
        const rel = typed as RelationshipFieldValue
        if (!rel.relatedEntityId) return null
        return {
          relatedEntityId: rel.relatedEntityId,
          relatedEntityDefinitionId: rel.relatedEntityDefinitionId || '',
        }
      }
      return null
    }

    // Handle raw relationship object (without type discriminator)
    if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
      const rel = value as { relatedEntityId: string; relatedEntityDefinitionId?: string }
      if (!rel.relatedEntityId) return null
      return {
        relatedEntityId: rel.relatedEntityId,
        relatedEntityDefinitionId: rel.relatedEntityDefinitionId || '',
      }
    }

    // Handle raw string ID (no definition ID available)
    if (typeof value === 'string' && value.trim()) {
      return {
        relatedEntityId: value.trim(),
        relatedEntityDefinitionId: '',
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display value.
   *
   * IMPORTANT: For relationships, this returns an object (not a string)
   * because display data must be fetched on the frontend using useRelationship hook.
   *
   * Frontend usage:
   *   const relData = relationshipConverter.toDisplayValue(value)
   *   const { items } = useRelationship(relData.relatedEntityDefinitionId, [relData.relatedEntityId])
   *   // Then render items with displayName, avatarUrl, etc.
   */
  toDisplayValue(value: TypedFieldValue): RelationshipRawValue | null {
    if (!value) {
      return null
    }

    const typed = value as RelationshipFieldValue

    if (!typed.relatedEntityId) {
      return null
    }

    // Return the full relationship object for frontend to hydrate
    // Display options are not used for relationships
    return {
      relatedEntityId: typed.relatedEntityId,
      relatedEntityDefinitionId: typed.relatedEntityDefinitionId || '',
    }
  },
}

// ============================================================================
// TYPE GUARDS - Re-exported for convenience
// ============================================================================

/**
 * Check if value is a RelationshipFieldValue object
 */
export function isRelationshipFieldValue(v: unknown): v is RelationshipFieldValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'relatedEntityId' in v &&
    'type' in v &&
    (v as Record<string, unknown>).type === 'relationship'
  )
}

/**
 * Check if value is an array of RelationshipFieldValue objects
 */
export function isRelationshipFieldValueArray(v: unknown): v is RelationshipFieldValue[] {
  return Array.isArray(v) && v.every(isRelationshipFieldValue)
}

/**
 * Check if value is a raw relationship object (without type discriminator)
 */
export function isRelationshipRawValue(v: unknown): v is RelationshipRawValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'relatedEntityId' in v &&
    typeof (v as Record<string, unknown>).relatedEntityId === 'string'
  )
}
