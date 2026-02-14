// packages/lib/src/field-values/field-value-service.ts

import { type Database, database } from '@auxx/database'
import type { FieldWithDefinition } from '@auxx/services'
import type { TypedFieldValue } from '@auxx/types'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
import { createFieldValueContext, type FieldValueContext } from './field-value-helpers'
import * as mutations from './field-value-mutations'
import * as queries from './field-value-queries'
import type {
  AddValueInput,
  BatchFieldValueResult,
  BatchGetValuesInput,
  DeleteValueInput,
  GetValueInput,
  GetValuesInput,
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
export class FieldValueService {
  /** Internal context shared across mutations and queries */
  private ctx: FieldValueContext

  /** Resource registry for batch field type lookups */
  private registryService: ResourceRegistryService

  constructor(
    private readonly organizationId: string,
    private readonly userId?: string,
    db: Database = database,
    registryService?: ResourceRegistryService
  ) {
    this.ctx = createFieldValueContext(organizationId, userId, db)
    this.registryService = registryService ?? new ResourceRegistryService(organizationId, db)
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
   * @param cachedField - Optional pre-fetched FieldWithDefinition to avoid lookup
   * @returns TypedFieldValue | TypedFieldValue[] | null
   */
  getValue(
    params: GetValueInput,
    cachedField?: FieldWithDefinition
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
    return queries.batchGetValues(this.ctx, this.registryService, params)
  }
}
