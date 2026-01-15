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

/**
 * Field path for relationship traversal.
 * Non-empty array of ResourceFieldId elements.
 *
 * Each element explicitly states which entity the field belongs to.
 * The path is validated by checking that related entities match.
 *
 * Examples:
 *   ["product:vendor", "vendor:name"]
 *     ↑                ↑
 *     |                └─ "name" field on "vendor" entity
 *     └──────────────── "vendor" field on "product" entity
 *
 *   ["product:vendor", "vendor:country", "country:name"]
 *     ↑                 ↑                  ↑
 *     |                 |                  └─ "name" on "country"
 *     |                 └──────────────────── "country" on "vendor"
 *     └────────────────────────────────────── "vendor" on "product"
 *
 *   ["vendor:products", "product:price"]  // has_many relationship
 */
export type FieldPath = [ResourceFieldId, ...ResourceFieldId[]] // At least 1 element

/**
 * Flexible field reference - either direct ResourceFieldId or relationship path
 */
export type FieldReference = ResourceFieldId | FieldPath

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
  toFieldPath,
  isFieldPath,
  validateFieldPath,
  fieldPathToString,
  getRootEntityId,
  getTargetFieldId,
} from './utils'
