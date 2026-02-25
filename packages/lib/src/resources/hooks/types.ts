// packages/lib/src/resources/hooks/types.ts

import type {
  CustomFieldEntity,
  EntityDefinitionEntity,
  EntityInstanceEntity,
} from '@auxx/database/types'

/**
 * Context provided to system hooks during entity operations
 */
export interface SystemHookContext {
  /** Operation being performed */
  operation: 'create' | 'update'

  /** Entity definition being operated on */
  entityDef: EntityDefinitionEntity

  /** Field being set (the field this hook is registered for) */
  field: CustomFieldEntity

  /** All field values being set in this operation */
  values: Record<string, unknown>

  /** Existing entity instance (only present for update operations) */
  existingInstance?: EntityInstanceEntity

  /** Organization ID for the operation */
  organizationId: string

  /** User ID performing the operation (for timeline events) */
  userId: string

  /** All custom fields for this entity (for looking up related fields) */
  allFields: CustomFieldEntity[]
}

/**
 * System hook function that runs before entity create/update operations.
 * Hooks can:
 * - Validate field values
 * - Normalize/transform values
 * - Throw errors to prevent the operation
 * - Modify values object to set additional fields
 *
 * @param context - Hook execution context
 * @returns Modified values object (can be same as input or new object)
 * @throws Error to prevent the operation
 */
export type SystemHook = (context: SystemHookContext) => Promise<Record<string, unknown>>

/**
 * Registry of system hooks for a specific entity type.
 * Maps systemAttribute names to arrays of hook functions.
 *
 * Example:
 * {
 *   'primary_email': [validateEmailFormat, normalizeEmail, checkEmailUniqueness],
 *   'contact_status': [validateStatusTransition, handleMergedStatus]
 * }
 */
export type SystemHookRegistry = Record<string, SystemHook[]>
