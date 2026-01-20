// packages/lib/src/field-values/converters/relationship.ts

import type { TypedFieldValueInput, TypedFieldValue, RelationshipFieldValue } from '@auxx/types/field-value'
import type { FieldValueConverter, ConverterOptions } from './index'
import { type RecordId, toRecordId, isRecordId } from '@auxx/types/resource'

/**
 * Relationship raw value is just RecordId.
 * Format: "entityDefinitionId:entityInstanceId"
 */
export type RelationshipRawValue = RecordId

/**
 * Converter for RELATIONSHIP field type.
 * Stores as relatedEntityId + relatedEntityDefinitionId in the database.
 * Uses RecordId format internally: "entityDefinitionId:entityInstanceId"
 *
 * NOTE: toDisplayValue returns RecordId (not an object) because
 * display data (names, avatars) must be fetched on the frontend
 * using the useRelationship hook.
 */
export const relationshipConverter: FieldValueConverter = {
  /**
   * Convert input to internal TypedFieldValue format.
   * Accepts:
   *   - RecordId directly (preferred): 'vendor:abc123'
   *   - Legacy { relatedEntityId, relatedEntityDefinitionId } (for migration)
   *   - Raw instance ID string (requires relatedEntityDefinitionId from options)
   */
  toTypedInput(value: unknown, options?: ConverterOptions): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // RecordId string - the preferred input format
    if (typeof value === 'string' && isRecordId(value)) {
      return { type: 'relationship', recordId: value }
    }

    // Handle already-typed values with recordId
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'relationship') {
        const rel = typed as RelationshipFieldValue
        if (!rel.recordId) return null
        return { type: 'relationship', recordId: rel.recordId }
      }
    }

    // Handle object with recordId (new format)
    if (typeof value === 'object' && value !== null && 'recordId' in value) {
      const obj = value as { recordId: RecordId }
      if (!obj.recordId) return null
      return { type: 'relationship', recordId: obj.recordId }
    }

    // Legacy format: { relatedEntityId, relatedEntityDefinitionId }
    if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
      const legacy = value as { relatedEntityId: string; relatedEntityDefinitionId?: string }
      if (!legacy.relatedEntityId) return null
      const defId = legacy.relatedEntityDefinitionId || options?.relatedEntityDefinitionId || ''
      if (!defId) return null
      return { type: 'relationship', recordId: toRecordId(defId, legacy.relatedEntityId) }
    }

    // Raw instance ID string (requires relatedEntityDefinitionId from options)
    if (typeof value === 'string' && value.trim() && options?.relatedEntityDefinitionId) {
      return { type: 'relationship', recordId: toRecordId(options.relatedEntityDefinitionId, value.trim()) }
    }

    return null
  },

  /**
   * Convert to raw value (returns the RecordId).
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): RelationshipRawValue | null {
    if (value === null || value === undefined) {
      return null
    }

    // Internal format { type: 'relationship', recordId }
    if (typeof value === 'object' && value !== null && 'recordId' in value) {
      return (value as { recordId: RecordId }).recordId || null
    }

    // Legacy format support
    if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
      const legacy = value as { relatedEntityId: string; relatedEntityDefinitionId?: string }
      if (!legacy.relatedEntityId || !legacy.relatedEntityDefinitionId) return null
      return toRecordId(legacy.relatedEntityDefinitionId, legacy.relatedEntityId)
    }

    // Already a RecordId string
    if (typeof value === 'string' && isRecordId(value)) {
      return value
    }

    return null
  },

  /**
   * Convert to display value (returns RecordId for frontend hydration).
   *
   * Frontend usage:
   *   const recordId = relationshipConverter.toDisplayValue(value)
   *   const { items } = useRelationship([recordId])
   */
  toDisplayValue(value: TypedFieldValue): RelationshipRawValue | null {
    if (!value) return null
    const typed = value as RelationshipFieldValue
    return typed.recordId || null
  },
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

// Re-export type guards from relationship-field.ts (single source of truth)
export {
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
} from '../relationship-field'

/**
 * Check if value is a raw relationship value (RecordId)
 */
export function isRelationshipRawValue(v: unknown): v is RelationshipRawValue {
  return isRecordId(v)
}
