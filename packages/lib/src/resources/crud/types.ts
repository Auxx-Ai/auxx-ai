// packages/lib/src/resources/crud/types.ts

import type { Database, Transaction } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import type { FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'

/**
 * Narrow entity-definition shape used by mutations and hooks.
 * Contains only the fields downstream callers read from the cached Resource
 * or EntityDefinition row — used to avoid a full DB fetch when the org cache
 * already has the definition.
 */
export interface ResolvedEntityDefinition {
  id: string
  /** `null` for custom entities — only the built-in resources carry one. */
  entityType: string | null
  /** Never null: `EntityDefinition.apiSlug` is `NOT NULL` and `Resource.apiSlug` is required. */
  apiSlug: string
}

/** Context passed to all CRUD operations */
export interface CrudContext {
  db: Database
  organizationId: string
  userId: string
  /** Optional transaction for batching */
  tx?: Transaction
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

/**
 * Selection for {@link UnifiedCrudHandler.getRecords} / `.getRecord`
 * (plans/apps/outbound/01-records-api.md §1). One `ReadOptions` applies to
 * every id in the call; a `fields`/`include` key a def doesn't have is simply
 * absent on that node, never an error. `include` depth is explicit — nest it
 * yourself, there is no implicit walk.
 */
export interface ReadOptions {
  /** Field keys to project. Default: every field on the def. */
  fields?: Array<FieldId | SystemAttribute>
  /** Relationship keys to expand, one level per entry. */
  include?: Record<string, ReadOptions>
}

/**
 * A whole record read back through {@link ReadOptions} — its own values plus
 * expanded relationships. Absent from the caller's map entirely when the
 * principal can't see the record (never `null`, or missing-vs-hidden leaks);
 * `redacted` carries only keys the def DOES have that the scope withheld.
 */
export interface RecordNode {
  recordId: RecordId
  entityDefinitionId: string
  displayName: string | null
  values: Record<string, TypedFieldValue | TypedFieldValue[] | null>
  included: Record<string, RecordNode | RecordNode[]>
  /** Field keys and include keys the scope dropped. Never a refusal — the caller decides. */
  redacted: string[]
}
