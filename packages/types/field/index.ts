// packages/types/field/index.ts

/**
 * Branded string type for field identification.
 *
 * For custom fields: This is the database UUID from CustomField.id
 * For system fields: This is the field key (e.g., 'email', 'firstName')
 *
 * Example: "cm1abc123xyz" (custom) or "email" (system)
 */
export type FieldId = string & { readonly __brand: 'FieldId' }

/**
 * Branded string type for resource field identification.
 * Format: `${entityDefinitionId}:${fieldId}`
 *
 * Uniquely identifies a field within a specific resource/entity definition.
 *
 * Examples:
 * - "contact:email" (system field on contact)
 * - "ticket:cm1abc123xyz" (custom field on ticket)
 * - "cm2def456uvw:cm1abc123xyz" (custom field on custom entity)
 */
export type ResourceFieldId = string & { readonly __brand: 'ResourceFieldId' }

export { resourceFieldIdSchema, fieldIdSchema } from './schema'
export {
  toFieldId,
  toResourceFieldId,
  parseResourceFieldId,
  isResourceFieldId,
  isFieldId,
  getFieldId,
  getFieldDefinitionId,
  toResourceFieldIds,
} from './utils'
