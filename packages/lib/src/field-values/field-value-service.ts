// packages/lib/src/field-values/field-value-service.ts

import { type Database, database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getCachedResourceFields } from '../cache'
import {
  type CachedField,
  createFieldValueContext,
  type FieldValueContext,
} from './field-value-helpers'
import * as mutations from './field-value-mutations'
import * as queries from './field-value-queries'
import type {
  AddRelationValuesBulkInput,
  AddRelationValuesInput,
  AddValueInput,
  BatchFieldValueResult,
  BatchGetValuesInput,
  DeleteValueInput,
  GetValueInput,
  GetValuesInput,
  RemoveRelationValuesBulkInput,
  RemoveRelationValuesInput,
  SetBulkValuesInput,
  SetValueInput,
  SetValueResult,
  SetValuesForEntityInput,
  SetValuesResult,
  SetValueWithBuiltInInput,
  SetValueWithTypeInput,
} from './types'

/**
 * Service for managing typed field values in the FieldValue table.
 * Orchestrates mutations and queries with shared context (caching, validation).
 *
 * Key features:
 * - Caches CustomField lookups within service instance
 * - Uses UPDATE for single-value fields instead of DELETE+INSERT
 * - Automatically updates EntityInstance.displayName when primary display field changes
 */
/** Optional extras for `FieldValueService` construction. */
export interface FieldValueServiceOptions {
  /**
   * SystemAttributes the caller is authorized to write even when a
   * registered field pre-hook would normally drop or reject them. Used
   * by trusted code paths like the seeder.
   */
  bypassFieldGuards?: ReadonlySet<SystemAttribute>
}

export class FieldValueService {
  /** Internal context shared across mutations and queries */
  readonly ctx: FieldValueContext

  constructor(
    private readonly organizationId: string,
    private readonly userId?: string,
    db: Database = database,
    socketId?: string,
    options: FieldValueServiceOptions = {}
  ) {
    this.ctx = createFieldValueContext(organizationId, userId, db, socketId, {
      bypassFieldGuards: options.bypassFieldGuards,
    })
  }

  // ─────────────────────────────────────────────────────────────
  // WRITE OPERATIONS (delegated to mutations module)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set a single field value with automatic type conversion and smart persistence strategy.
   *
   * This is a lower-level method that requires callers to handle field type detection.
   * For higher-level usage, prefer setValueWithBuiltIn() which handles built-in fields.
   *
   * @param params - The SetValueInput object
   * @returns Array of TypedFieldValue objects after the operation.
   */
  setValue(params: SetValueInput): Promise<TypedFieldValue[]> {
    return mutations.setValue(this.ctx, params)
  }

  /**
   * Set field value when caller already has the field type information.
   *
   * This method skips the CustomField lookup (since you provide fieldType), making it more
   * efficient when called multiple times in a batch or when you already know the field type.
   *
   * @param params - The SetValueWithTypeInput object
   * @returns Array of TypedFieldValue objects after the operation.
   */
  setValueWithType(params: SetValueWithTypeInput): Promise<TypedFieldValue[]> {
    return mutations.setValueWithType(this.ctx, params)
  }

  /**
   * Add a single value to a multi-value field without removing existing values.
   * APPEND operation - calculates correct sort order based on existing values.
   *
   * @param params - The AddValueInput object
   * @returns Single TypedFieldValue for the newly added value
   */
  addValue(params: AddValueInput): Promise<TypedFieldValue> {
    return mutations.addValue(this.ctx, params)
  }

  /**
   * Remove a single value from a multi-value field by its FieldValue ID.
   *
   * @param valueId - The FieldValue record ID (UUID)
   */
  removeValue(valueId: string): Promise<void> {
    return mutations.removeValue(this.ctx, valueId)
  }

  /**
   * Delete all values for a field on an entity.
   *
   * @param params - Delete value input
   */
  deleteValue(params: DeleteValueInput): Promise<void> {
    return mutations.deleteValue(this.ctx, params)
  }

  /**
   * Add relation values to an existing multi-value relationship field (no duplicates).
   * Appends new values after existing ones. Syncs inverse relationships.
   */
  addRelationValues(params: AddRelationValuesInput): Promise<void> {
    return mutations.addRelationValues(this.ctx, params)
  }

  /**
   * Remove specific relation values from an existing multi-value relationship field.
   * Syncs inverse relationships for removals.
   */
  removeRelationValues(params: RemoveRelationValuesInput): Promise<void> {
    return mutations.removeRelationValues(this.ctx, params)
  }

  /**
   * Add the same related records to many source entities in one vectorized call.
   * Flat query budget with respect to number of source/target records.
   */
  addRelationValuesBulk(
    params: AddRelationValuesBulkInput
  ): Promise<{ inserted: number; skipped: number }> {
    return mutations.addRelationValuesBulk(this.ctx, params)
  }

  /**
   * Remove the same related records from many source entities in one vectorized call.
   */
  removeRelationValuesBulk(params: RemoveRelationValuesBulkInput): Promise<{ removed: number }> {
    return mutations.removeRelationValuesBulk(this.ctx, params)
  }

  /**
   * Append values to any multi-value field (scalar types with options.multi,
   * MULTI_SELECT, TAGS, RELATIONSHIP, FILE, multi-ACTOR). Server-side dedups
   * against existing rows via typed equality under an advisory lock.
   *
   * Throws `BadRequestError` if the target field is not multi-value.
   */
  addValues(params: {
    recordId: RecordId
    fieldId: string
    values: unknown[]
  }): Promise<TypedFieldValue[]> {
    return mutations.addValues(this.ctx, params)
  }

  /**
   * Delete specific values from any multi-value field by typed equality.
   * Throws `BadRequestError` if the target field is not multi-value.
   */
  removeValues(params: { recordId: RecordId; fieldId: string; values: unknown[] }): Promise<void> {
    return mutations.removeValues(this.ctx, params)
  }

  /**
   * Bulk-add the same values to many source records on a single field.
   */
  addValuesBulk(params: {
    recordIds: RecordId[]
    fieldId: string
    values: unknown[]
  }): Promise<{ inserted: number; skipped: number }> {
    return mutations.addValuesBulk(this.ctx, params)
  }

  /**
   * Bulk-remove the same values from many source records on a single field.
   */
  removeValuesBulk(params: {
    recordIds: RecordId[]
    fieldId: string
    values: unknown[]
  }): Promise<{ removed: number }> {
    return mutations.removeValuesBulk(this.ctx, params)
  }

  /**
   * Set a field value with built-in field support and optional event publishing.
   * Primary entry point for setting field values - handles both built-in and custom fields.
   *
   * @param params - The SetValueWithBuiltInInput object
   * @returns SetValueResult with state, performedAt, and values array
   */
  setValueWithBuiltIn(params: SetValueWithBuiltInInput): Promise<SetValueResult> {
    return mutations.setValueWithBuiltIn(this.ctx, params)
  }

  /**
   * Set multiple field values for a single entity in an optimized batch operation.
   * Preferred method when setting 2+ fields on the same entity.
   *
   * @param params - The SetValuesForEntityInput object
   * @returns Array of SetValuesResult (one per field)
   */
  setValuesForEntity(params: SetValuesForEntityInput): Promise<SetValuesResult[]> {
    return mutations.setValuesForEntity(this.ctx, params)
  }

  /**
   * Set the same field values for multiple entities in a resilient batch operation.
   * Uses Promise.allSettled to handle failures gracefully without blocking other updates.
   *
   * @param params - The SetBulkValuesInput object
   * @returns Object with count of successfully updated entities
   */
  setBulkValues(params: SetBulkValuesInput): Promise<{ count: number }> {
    return mutations.setBulkValues(this.ctx, params)
  }

  // ─────────────────────────────────────────────────────────────
  // READ OPERATIONS (delegated to queries module)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a single field value for an entity.
   * Returns TypedFieldValue for single-value fields, TypedFieldValue[] for multi-value fields, or null.
   *
   * @param params - Get value input
   * @param cachedField - Optional pre-fetched CachedField to avoid lookup
   * @returns TypedFieldValue | TypedFieldValue[] | null
   */
  getValue(
    params: GetValueInput,
    cachedField?: CachedField
  ): Promise<TypedFieldValue | TypedFieldValue[] | null> {
    return queries.getValue(this.ctx, params, cachedField)
  }

  /**
   * Get multiple field values for an entity in a single efficient query.
   * Returns Map keyed by fieldId. Use this instead of calling getValue() multiple times.
   *
   * @param params - Get values input
   * @returns Map<fieldId, TypedFieldValue | TypedFieldValue[]>
   */
  getValues(params: GetValuesInput): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
    return queries.getValues(this.ctx, params)
  }

  /**
   * Get field values for multiple entities with relationship traversal support.
   *
   * Handles both direct fields (ResourceFieldId) and relationship paths (FieldPath).
   * For paths, traverses relationships and collects terminal field values.
   *
   * Query efficiency: O(max path depth) queries regardless of record count.
   *
   * @param params - Batch get values input
   * @param params.recordIds - Array of RecordIds
   * @param params.fieldReferences - Array of FieldReferences (ResourceFieldId or FieldPath)
   * @returns BatchFieldValueResult containing values array
   *
   * @example
   * // Direct field fetch
   * const result = await service.batchGetValues({
   *   recordIds: ["contact:abc123"],
   *   fieldReferences: ["contact:email", "contact:name"]
   * });
   *
   * @example
   * // Relationship path fetch
   * const result = await service.batchGetValues({
   *   recordIds: ["product:xyz"],
   *   fieldReferences: [["product:vendor", "vendor:name"]]
   * });
   */
  batchGetValues(params: BatchGetValuesInput): Promise<BatchFieldValueResult> {
    return queries.batchGetValues(this.ctx, params)
  }
}
