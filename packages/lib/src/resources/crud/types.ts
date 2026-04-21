// packages/lib/src/resources/crud/types.ts

import type { Database, Transaction } from '@auxx/database'

/**
 * Narrow entity-definition shape used by mutations and hooks.
 * Contains only the fields downstream callers read from the cached Resource
 * or EntityDefinition row — used to avoid a full DB fetch when the org cache
 * already has the definition.
 */
export interface ResolvedEntityDefinition {
  id: string
  entityType: string | null
  apiSlug: string | null
}

/** Context passed to all CRUD operations */
export interface CrudContext {
  db: Database
  organizationId: string
  userId: string
  /** Optional transaction for batching */
  tx?: Transaction
  /** Skip event publishing (e.g., bulk imports) */
  skipEvents?: boolean
}

/** Result of a CRUD operation - success case */
export interface CrudResultSuccess<T = Record<string, unknown>> {
  success: true
  id: string
  record?: T
}

/** Result of a CRUD operation - failure case */
export interface CrudResultFailure {
  success: false
  error: string
  errorCode?: string
  field?: string
}

/** Result of a CRUD operation */
export type CrudResult<T = Record<string, unknown>> = CrudResultSuccess<T> | CrudResultFailure

/** Transformed input data (after field mapping) */
export interface TransformedData {
  /** System resource fields (e.g., email, firstName for contacts) */
  standardFields: Record<string, unknown>
  /** Custom field values keyed by field ID */
  customFields: Record<string, unknown>
}

/** Bulk operation result */
export interface BulkResult {
  total: number
  succeeded: number
  failed: number
  results: Array<CrudResult & { index: number }>
}

/** Options for creating a record */
export interface CreateRecordOptions {
  /** Standard field values */
  standardFields: Record<string, unknown>
  /** Custom field values (keyed by field ID) */
  customFields?: Record<string, unknown>
}

/** Options for updating a record */
export interface UpdateRecordOptions extends CreateRecordOptions {
  /** ID of the record to update */
  id: string
}

/** Options for finding a record by field value */
export interface FindByFieldOptions {
  /** Field key to match on */
  fieldKey: string
  /** Value to match */
  value: string
  /** Custom field ID if this is a custom field */
  customFieldId?: string
}
