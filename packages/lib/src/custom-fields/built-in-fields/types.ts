// packages/lib/src/custom-fields/built-in-fields/types.ts

import type { FieldType } from '@auxx/database/types'
import type { Database, Transaction } from '@auxx/database'

/**
 * Handler function for a built-in field
 *
 * @param db - Database connection or transaction
 * @param entityId - ID of the entity being updated
 * @param value - New value for the field
 * @param organizationId - ID of the organization
 */
export type BuiltInFieldHandler = (
  db: Database | Transaction,
  entityId: string,
  value: any,
  organizationId: string
) => Promise<void>

/**
 * Configuration for a built-in field
 */
export interface BuiltInFieldConfig {
  /** Unique identifier for the field */
  id: string
  /** Type of the field */
  type: FieldType
  /** Handler function to update the field */
  handler: BuiltInFieldHandler
}

/**
 * Registry of built-in fields for a specific model
 */
export type BuiltInFieldRegistry = Record<string, BuiltInFieldConfig>
