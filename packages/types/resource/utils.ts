// packages/types/resource/utils.ts

import type { RecordId } from './index'
import { ModelTypeValues, type ModelType } from '@auxx/database/enums'

/**
 * Create a RecordId from entityDefinitionId and entityInstanceId.
 */
export function toRecordId(entityDefinitionId: string, entityInstanceId: string): RecordId {
  return `${entityDefinitionId}:${entityInstanceId}` as RecordId
}

/**
 * Parse a RecordId back to its components.
 */
export function parseRecordId(recordId: RecordId): {
  entityDefinitionId: string
  entityInstanceId: string
} {
  // Defensive check for undefined/null
  if (!recordId) {
    console.error('[parseRecordId] RecordId is undefined or null:', recordId)
    return { entityDefinitionId: '', entityInstanceId: '' }
  }

  const colonIndex = recordId.indexOf(':')
  if (colonIndex === -1) {
    console.error('[parseRecordId] Malformed RecordId (missing colon):', recordId)
    return { entityDefinitionId: recordId, entityInstanceId: '' }
  }
  return {
    entityDefinitionId: recordId.slice(0, colonIndex),
    entityInstanceId: recordId.slice(colonIndex + 1),
  }
}

/**
 * Type guard to check if a string is a valid RecordId format.
 */
export function isRecordId(value: unknown): value is RecordId {
  return typeof value === 'string' && value.includes(':')
}

/**
 * Create RecordId[] from entityDefinitionId and array of instance IDs.
 */
export function toRecordIds(entityDefinitionId: string, instanceIds: string[]): RecordId[] {
  return instanceIds.map((id) => toRecordId(entityDefinitionId, id))
}

/**
 * Extract just the entityInstanceId from a RecordId.
 */
export function getInstanceId(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/**
 * Extract just the entityDefinitionId from a RecordId.
 */
export function getDefinitionId(recordId: RecordId): string {
  return parseRecordId(recordId).entityDefinitionId
}

/**
 * Check if an entityDefinitionId is a system ModelType.
 */
export function isSystemModelType(entityDefinitionId: string): entityDefinitionId is ModelType {
  return (ModelTypeValues as readonly string[]).includes(entityDefinitionId)
}

/**
 * Derive ModelType from entityDefinitionId.
 * If entityDefinitionId is a known system ModelType, return it.
 * Otherwise (custom entity UUID), return 'entity'.
 */
export function getModelType(entityDefinitionId: string): ModelType {
  return isSystemModelType(entityDefinitionId) ? entityDefinitionId : 'entity'
}

