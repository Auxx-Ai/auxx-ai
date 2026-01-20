// packages/lib/src/field-values/relationship-field.ts

import type { RelationshipFieldValue } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId, isRecordId } from '../resources/resource-id'
import { isMultiRelationship, isSingleRelationship, type RelationshipType } from '@auxx/utils'

// Re-export relationship type utilities from @auxx/utils
export { isMultiRelationship, isSingleRelationship, type RelationshipType }

// ============================================================================
// TYPE GUARDS - Narrow and validate relationship values
// ============================================================================

/** Check if value is a RelationshipFieldValue object with recordId */
export function isRelationshipFieldValue(v: unknown): v is RelationshipFieldValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as { type: string }).type === 'relationship' &&
    'recordId' in v &&
    isRecordId((v as { recordId: unknown }).recordId)
  )
}

/** Check if value is an array of RelationshipFieldValue objects */
export function isRelationshipFieldValueArray(v: unknown): v is RelationshipFieldValue[] {
  return Array.isArray(v) && v.every(isRelationshipFieldValue)
}

// ============================================================================
// RECORD ID EXTRACTORS - For useRelationship hook
// ============================================================================

/**
 * Extract RecordId[] from ANY relationship value format.
 * Handles: objects (new recordId format), arrays, null, undefined.
 * Also supports legacy format for backwards compatibility.
 *
 * @example
 * const recordIds = extractRelationshipRecordIds(value)
 * const { items } = useRelationship(recordIds)
 */
export function extractRelationshipRecordIds(value: unknown): RecordId[] {
  if (!value) {
    return []
  }

  const recordIds: RecordId[] = []

  /** Helper to extract RecordId from a single value */
  const extractSingle = (item: unknown): RecordId | null => {
    if (!item) return null
    // Already a RecordId string
    if (typeof item === 'string' && isRecordId(item)) {
      return item
    }
    // New format: { recordId }
    if (typeof item === 'object' && 'recordId' in item) {
      const rel = item as { recordId: RecordId }
      return rel.recordId || null
    }
    // Legacy format: { relatedEntityId, relatedEntityDefinitionId }
    if (typeof item === 'object' && 'relatedEntityId' in item) {
      const rel = item as { relatedEntityId: string; relatedEntityDefinitionId?: string }
      if (rel.relatedEntityDefinitionId && rel.relatedEntityId) {
        return toRecordId(rel.relatedEntityDefinitionId, rel.relatedEntityId)
      }
    }
    return null
  }

  // Array of values
  if (Array.isArray(value)) {
    for (const item of value) {
      const rid = extractSingle(item)
      if (rid) recordIds.push(rid)
    }
    return recordIds
  }

  // Single value
  const rid = extractSingle(value)
  if (rid) return [rid]

  return []
}

// Re-export from resource-id for convenience
export {
  toRecordId,
  parseRecordId,
  isRecordId,
  toRecordIds,
  getInstanceId,
  getDefinitionId,
} from '../resources/resource-id'
