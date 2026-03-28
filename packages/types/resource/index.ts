// packages/types/resource/index.ts

/**
 * Branded string type for record identification.
 * Format: `${entityDefinitionId}:${entityInstanceId}`
 *
 * Example: "contact:abc123" or "cm1abc123xyz:inst456"
 */
export type RecordId = string & { readonly __brand: 'RecordId' }

export { recordIdSchema } from './schema'
export {
  ENTITY_DEFINITION_TYPES,
  type EntityDefinitionType,
  getDefinitionId,
  getInstanceId,
  getModelType,
  isEntityDefinitionType,
  isRecordId,
  isSystemModelType,
  normalizeToRecordId,
  normalizeToRecordIds,
  parseRecordId,
  toRecordId,
  toRecordIds,
} from './utils'
