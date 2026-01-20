// packages/lib/src/field-values/relationship-field.ts

import type { RelationshipFieldValue } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '../resources/resource-id'
import { isMultiRelationship, isSingleRelationship, type RelationshipType } from '@auxx/utils'

// Re-export relationship type utilities from @auxx/utils
export { isMultiRelationship, isSingleRelationship, type RelationshipType }

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
// RECORD ID EXTRACTORS - For useRelationship hook
// ============================================================================

/**
 * Extract RecordId[] from ANY relationship value format.
 * Handles: objects, arrays, null, undefined.
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

  // Array of full objects
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'object' && item !== null && 'relatedEntityId' in item) {
        const rel = item as RelationshipFieldValue
        const entityDefId = rel.relatedEntityDefinitionId
        if (entityDefId && rel.relatedEntityId) {
          recordIds.push(toRecordId(entityDefId, rel.relatedEntityId))
        }
      }
    }
    return recordIds
  }

  // Single object with relatedEntityId
  if (typeof value === 'object' && 'relatedEntityId' in value) {
    const rel = value as RelationshipFieldValue
    const entityDefId = rel.relatedEntityDefinitionId
    if (entityDefId && rel.relatedEntityId) {
      return [toRecordId(entityDefId, rel.relatedEntityId)]
    }
  }

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
