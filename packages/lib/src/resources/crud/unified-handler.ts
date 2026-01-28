// packages/lib/src/resources/crud/unified-handler.ts

import type { Database } from '@auxx/database'
import { database as defaultDatabase, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { getEntityInstance, listEntityInstances } from '@auxx/services/entity-instances'
import { getEntityDefinition } from '@auxx/services/entity-definitions'
import { getCustomFields, checkUniqueValue } from '@auxx/services/custom-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import { FieldValueService } from '../../field-values'
import { publisher } from '../../events/publisher'
import { invalidateSnapshots, getOrCreateSnapshot, getSnapshotChunk } from '../../snapshot'
import { toRecordId, parseRecordId, type RecordId } from '../resource-id'
import { getSystemHooks, getCommonHooks } from '../hooks'
import { RecordPickerService } from '../picker'
import type { MergeEntitiesResult } from '../merge'
import type { ConditionGroup } from '../../conditions'
import {
  queryEntityInstanceIds,
  querySystemResourceIds,
  isSystemResource,
  type ListFilteredResult,
} from './unified-handler-queries'
import {
  createEntity,
  updateEntity,
  archiveEntity,
  restoreEntity,
  deleteEntity,
  bulkCreateEntities,
  bulkUpdateEntities,
  bulkArchiveEntities,
  bulkDeleteEntities,
  bulkSetFieldValue,
  mergeEntities,
  createWithValues as createWithValuesImpl,
  updateValues as updateValuesImpl,
  type CrudOptions,
  type MutationContext,
  type CreateEntityResult,
} from './unified-handler-mutations'
import { SYSTEM_FIELD_KEYS, type TableId } from '../registry/field-registry'
// import type { EntityDefinitionEntity } from '@auxx/database/schema/entity-definition'
// import type { EntityInstanceEntity } from '@auxx/database/schema/entity-instance'

/** Inferred type for CustomField select (not exported from schema) */
type CustomFieldEntity = typeof schema.CustomField.$inferSelect
type EntityDefinitionEntity = typeof schema.EntityDefinition.$inferSelect
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/**
 * Helper to unwrap neverthrow Result and throw on error
 */
function unwrapResult<T, E extends { message: string }>(result: {
  isErr: () => boolean
  error: E
  value: T
}): T {
  if (result.isErr()) {
    throw new Error(result.error.message)
  }
  return result.value
}

// Re-export CrudOptions for backwards compatibility
export type { CrudOptions } from './unified-handler-mutations'

/**
 * Unified CRUD handler for ALL entity types.
 * Replaces EntityInstanceService, ContactService, TicketService.
 *
 * Features:
 * - Works with both system entities (contact, ticket) and custom entities
 * - Integrates system hooks for validation and normalization
 * - Provides findByField and findOrCreate methods
 * - Handles bulk operations efficiently
 * - Manages events, snapshots, and field values consistently
 *
 * @example
 * ```typescript
 * const handler = new UnifiedCrudHandler(organizationId, userId, db)
 *
 * // Create a contact
 * const contact = await handler.create('contact', {
 *   primary_email: 'john@example.com',
 *   first_name: 'John',
 *   last_name: 'Doe'
 * })
 *
 * // Update a contact
 * const recordId = toRecordId('contact', contact.id)
 * await handler.update(recordId, {
 *   first_name: 'Jane'
 * })
 *
 * // Find or create
 * const { instance, created } = await handler.findOrCreate(
 *   'contact',
 *   { primary_email: 'jane@example.com' },
 *   { first_name: 'Jane', last_name: 'Smith' }
 * )
 * ```
 */
export class UnifiedCrudHandler {
  private fieldValueService: FieldValueService
  private db: Database

  /** Cache for EntityDefinition lookups (keyed by entityDefinitionId or system type) */
  private entityDefCache: Map<string, EntityDefinitionEntity> = new Map()

  /** Cache for CustomField lookups (keyed by entityDefinitionId) */
  private customFieldsCache: Map<string, CustomFieldEntity[]> = new Map()

  constructor(
    private organizationId: string,
    private userId: string,
    db?: Database
  ) {
    this.db = db ?? defaultDatabase
    this.fieldValueService = new FieldValueService(organizationId, userId, this.db)
  }

  /**
   * Create mutation context for delegating to mutation functions
   */
  private getMutationContext(): MutationContext {
    return {
      db: this.db,
      organizationId: this.organizationId,
      userId: this.userId,
      fieldValueService: this.fieldValueService,
      resolveEntityDefinition: this.resolveEntityDefinition.bind(this),
      getFields: this.getCustomFieldsCached.bind(this),
      runPreHooks: this.runPreHooks.bind(this),
      validateUniqueFields: this.validateUniqueFields.bind(this),
      setFieldValues: this.setFieldValues.bind(this),
    }
  }

  /**
   * Pre-warm caches for bulk operations.
   * Call this once before processing many records of the same entity type.
   *
   * @param entityDefinitionId - Entity definition ID to cache
   */
  async warmCache(entityDefinitionId: string): Promise<void> {
    await this.resolveEntityDefinition(entityDefinitionId)
    const entityDef = this.entityDefCache.get(entityDefinitionId)
    if (entityDef) {
      await this.getCustomFieldsCached(entityDef.id)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE RECORD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create entity instance with field values and system hooks.
   * Returns the created instance, recordId, and all processed values
   * (including auto-generated values like ticket_number).
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param values - Field values to set (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   * @returns CreateEntityResult with instance, recordId, and all field values
   */
  async create(
    entityDefinitionId: string,
    values: Record<string, unknown>,
    options: CrudOptions = {}
  ): Promise<CreateEntityResult> {
    await this.warmCache(entityDefinitionId)
    return createEntity(this.getMutationContext(), entityDefinitionId, values, options)
  }

  /**
   * Update entity instance field values
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Field values to update (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async update(recordId: RecordId, values: Record<string, unknown>, options: CrudOptions = {}) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.warmCache(entityDefinitionId)
    return updateEntity(this.getMutationContext(), recordId, values, options)
  }

  /**
   * Get entity instance by ID
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   */
  async getById(recordId: RecordId) {
    const { entityInstanceId } = parseRecordId(recordId)
    const result = await getEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
    })
    return result.isOk() ? result.value : null
  }

  /**
   * Find entity by field value (e.g., find contact by email)
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param fieldSystemAttribute - System attribute like 'primary_email'
   * @param value - Value to search for
   */
  async findByField(entityDefinitionId: string, fieldSystemAttribute: string, value: unknown) {
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Get field by systemAttribute
    const field = await this.getFieldBySystemAttribute(entityDef.id, fieldSystemAttribute)
    if (!field) return null

    // Query FieldValue table for matching value
    const rows = await this.db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, field.id),
          eq(schema.FieldValue.organizationId, this.organizationId),
          eq(schema.FieldValue.valueText, String(value))
        )
      )
      .limit(1)

    if (rows.length === 0) return null

    const recordId = toRecordId(entityDef.id, rows[0]!.entityId)
    return this.getById(recordId)
  }

  /**
   * Find or create entity
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param findBy - Fields to search by (e.g., { primary_email: 'test@example.com' })
   * @param createValues - Additional values to set if creating
   */
  async findOrCreate(
    entityDefinitionId: string,
    findBy: Record<string, unknown>,
    createValues: Record<string, unknown> = {}
  ): Promise<{ instance: EntityInstanceEntity; created: boolean }> {
    // Try to find by the findBy fields first
    const [fieldKey, fieldValue] = Object.entries(findBy)[0]!
    const existing = await this.findByField(entityDefinitionId, fieldKey, fieldValue)

    if (existing) {
      return { instance: existing, created: false }
    }

    const instance = await this.create(entityDefinitionId, { ...findBy, ...createValues })
    return { instance, created: true }
  }

  /**
   * Archive entity instance (soft delete)
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async archive(recordId: RecordId, options: CrudOptions = {}) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.warmCache(entityDefinitionId)
    return archiveEntity(this.getMutationContext(), recordId, options)
  }

  /**
   * Restore archived entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async restore(recordId: RecordId, options: CrudOptions = {}) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.warmCache(entityDefinitionId)
    return restoreEntity(this.getMutationContext(), recordId, options)
  }

  /**
   * Permanently delete entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async delete(recordId: RecordId, options: CrudOptions = {}): Promise<void> {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.warmCache(entityDefinitionId)
    return deleteEntity(this.getMutationContext(), recordId, options)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bulk create entities
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param items - Array of field value maps to create
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkCreate(
    entityDefinitionId: string,
    items: Record<string, unknown>[],
    options: CrudOptions = {}
  ): Promise<{ created: EntityInstanceEntity[]; errors: Array<{ index: number; error: string }> }> {
    if (items.length === 0) return { created: [], errors: [] }
    await this.warmCache(entityDefinitionId)
    return bulkCreateEntities(this.getMutationContext(), entityDefinitionId, items, options)
  }

  /**
   * Bulk update entities
   *
   * @param updates - Array of { recordId, values } to update
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkUpdate(
    updates: Array<{ recordId: RecordId; values: Record<string, unknown> }>,
    options: CrudOptions = {}
  ): Promise<{ updated: number; errors: Array<{ recordId: RecordId; error: string }> }> {
    if (updates.length === 0) return { updated: 0, errors: [] }
    const { entityDefinitionId } = parseRecordId(updates[0]!.recordId)
    await this.warmCache(entityDefinitionId)
    return bulkUpdateEntities(this.getMutationContext(), updates, options)
  }

  /**
   * Bulk archive entities (soft delete)
   *
   * @param recordIds - Array of RecordIds to archive
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkArchive(recordIds: RecordId[], options: CrudOptions = {}): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    return bulkArchiveEntities(this.getMutationContext(), recordIds, options)
  }

  /**
   * Bulk delete entities (hard delete)
   *
   * @param recordIds - Array of RecordIds to delete
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkDelete(recordIds: RecordId[], options: CrudOptions = {}): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    return bulkDeleteEntities(this.getMutationContext(), recordIds, options)
  }

  /**
   * Bulk set field value across multiple entities
   *
   * @param recordIds - Array of RecordIds to update
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async bulkSetFieldValue(
    recordIds: RecordId[],
    fieldId: string,
    value: unknown
  ): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }
    return bulkSetFieldValue(this.getMutationContext(), recordIds, fieldId, value)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List entities with pagination
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param options - List options (filters, sorting, pagination)
   */
  async list(
    entityDefinitionId: string,
    options?: {
      includeArchived?: boolean
      limit?: number
      cursor?: string
    }
  ): Promise<{ items: EntityInstanceEntity[]; nextCursor?: string }> {
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const result = await listEntityInstances({
      organizationId: this.organizationId,
      entityDefinitionId: entityDef.id,
      includeArchived: options?.includeArchived,
      limit: options?.limit,
      cursor: options?.cursor,
    })

    return unwrapResult(result)
  }

  /**
   * List record IDs with server-side filtering (Query Snapshot pattern)
   * Returns cached snapshot IDs for efficient pagination
   *
   * @param params - Filter parameters
   */
  async listFiltered(params: {
    entityDefinitionId: string
    filters?: ConditionGroup[]
    sorting?: Array<{ id: string; desc: boolean }>
    limit?: number
    cursor?: { snapshotId: string; offset: number }
  }): Promise<ListFilteredResult> {
    const { entityDefinitionId, filters = [], sorting = [], limit = 100, cursor } = params

    // Extract pagination from cursor if provided
    const snapshotId = cursor?.snapshotId
    const offset = cursor?.offset ?? 0

    // If snapshotId provided via cursor, try to fetch chunk from cache
    if (snapshotId) {
      const chunk = await getSnapshotChunk({
        snapshotId,
        offset,
        limit,
      })

      if (chunk) {
        return {
          snapshotId,
          ids: chunk.ids,
          total: chunk.total,
          hasMore: offset + chunk.ids.length < chunk.total,
        }
      }
      // Snapshot expired - fall through to create a new one
    }

    // No snapshotId - create new snapshot
    const result = await getOrCreateSnapshot({
      organizationId: this.organizationId,
      resourceType: entityDefinitionId,
      filters: filters as ConditionGroup[],
      sorting,
      executeQuery: async () => {
        // Route to appropriate query function
        if (isSystemResource(entityDefinitionId)) {
          return querySystemResourceIds({
            db: this.db,
            tableId: entityDefinitionId as TableId,
            organizationId: this.organizationId,
            filters: filters as ConditionGroup[],
            sorting,
          })
        }

        // Otherwise treat as custom entity (UUID)
        return queryEntityInstanceIds({
          db: this.db,
          entityDefinitionId,
          organizationId: this.organizationId,
          filters: filters as ConditionGroup[],
          sorting,
        })
      },
    })

    // Return first chunk
    const ids = result.ids.slice(offset, offset + limit)

    return {
      snapshotId: result.snapshotId,
      ids,
      total: result.total,
      hasMore: offset + ids.length < result.total,
      fromCache: result.fromCache,
    }
  }

  /**
   * Get multiple records by RecordIds (batch)
   *
   * @param recordIds - Array of RecordIds to fetch
   */
  async getByIds(recordIds: RecordId[]) {
    if (recordIds.length === 0) return []

    const service = new RecordPickerService(this.organizationId, this.userId, this.db)
    return service.getResourcesByIds(recordIds)
  }

  /**
   * Search records with optional global search support
   *
   * @param params - Search parameters
   */
  async search(params: {
    query?: string
    entityDefinitionId?: string
    entityDefinitionIds?: string[]
    limit?: number
    cursor?: string
  }) {
    const service = new RecordPickerService(this.organizationId, this.userId, this.db)
    return service.search({
      query: params.query ?? '',
      entityDefinitionId: params.entityDefinitionId,
      entityDefinitionIds: params.entityDefinitionIds,
      limit: params.limit,
      cursor: params.cursor,
    })
  }

  /**
   * Invalidate cache for a resource type or specific record
   *
   * @param entityDefinitionId - Resource type to invalidate
   * @param id - Optional specific record ID
   */
  async invalidateCache(entityDefinitionId: string, id?: string): Promise<void> {
    const service = new RecordPickerService(this.organizationId, this.userId, this.db)

    if (id) {
      await service.invalidateCacheById(entityDefinitionId, id)
    } else {
      await service.invalidateCacheByTable(entityDefinitionId)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Merge multiple entity instances into a single target
   * Delegates to EntityMergeService for actual merge logic
   *
   * @param targetRecordId - RecordId of the target instance
   * @param sourceRecordIds - RecordIds of instances to merge into target
   */
  async merge(targetRecordId: RecordId, sourceRecordIds: RecordId[]) {
    return mergeEntities(this.getMutationContext(), targetRecordId, sourceRecordIds)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW-COMPATIBLE WRAPPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create entity instance with field values (workflow-compatible)
   * Wraps create() to match EntityInstanceService.createWithValues() signature
   *
   * @param entityDefinitionId - Entity definition ID
   * @param values - Field values (fieldId -> value)
   */
  async createWithValues(entityDefinitionId: string, values: Record<string, unknown>) {
    await this.warmCache(entityDefinitionId)
    return createWithValuesImpl(this.getMutationContext(), entityDefinitionId, values)
  }

  /**
   * Update entity instance field values (workflow-compatible)
   * Wraps update() to match EntityInstanceService.updateValues() signature
   *
   * @param instanceId - Entity instance ID (not RecordId)
   * @param values - Field values to update (fieldId -> value)
   */
  async updateValues(instanceId: string, values: Record<string, unknown>) {
    return updateValuesImpl(this.getMutationContext(), instanceId, values)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD VALUE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set single field value
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async setFieldValue(recordId: RecordId, fieldId: string, value: unknown): Promise<void> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Use FieldValueService with RecordId (no modelType needed)
    await this.fieldValueService.setValueWithBuiltIn({
      recordId,
      fieldId,
      value,
    })

    await this.invalidateSnapshots(entityDef.id)
    await this.publishEvent('updated', entityDef, entityInstanceId, { [fieldId]: value })
  }

  /**
   * Get field values for entity
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param fieldIds - Optional array of field IDs to fetch
   */
  async getFieldValues(recordId: RecordId, fieldIds?: string[]) {
    // Use FieldValueService with RecordId
    return this.fieldValueService.getValues({ recordId, fieldIds })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve entity definition by ID or system type (cached)
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   */
  private async resolveEntityDefinition(entityDefinitionId: string) {
    // Check cache first
    const cached = this.entityDefCache.get(entityDefinitionId)
    if (cached) return cached

    let entityDef: EntityDefinitionEntity

    // System types map to entityType column - query by entityType
    if (['contact', 'ticket', 'part', 'entity_group', 'inbox'].includes(entityDefinitionId)) {
      const rows = await this.db
        .select()
        .from(schema.EntityDefinition)
        .where(
          and(
            eq(schema.EntityDefinition.entityType, entityDefinitionId),
            eq(schema.EntityDefinition.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (rows.length === 0) {
        throw new Error(`System entity definition not found: ${entityDefinitionId}`)
      }

      entityDef = rows[0]!
    } else {
      // Otherwise treat as UUID
      const result = await getEntityDefinition({
        id: entityDefinitionId,
        organizationId: this.organizationId,
      })
      entityDef = unwrapResult(result)
    }

    // Cache by both the input ID and the resolved UUID
    this.entityDefCache.set(entityDefinitionId, entityDef)
    if (entityDef.id !== entityDefinitionId) {
      this.entityDefCache.set(entityDef.id, entityDef)
    }

    return entityDef
  }

  /**
   * Get custom fields for an entity definition (cached)
   *
   * @param entityDefinitionId - Entity definition UUID
   */
  private async getCustomFieldsCached(entityDefinitionId: string) {
    const cached = this.customFieldsCache.get(entityDefinitionId)
    if (cached) return cached

    const result = await getCustomFields({
      organizationId: this.organizationId,
      entityDefinitionId,
    })

    if (result.isErr()) return []

    this.customFieldsCache.set(entityDefinitionId, result.value)
    return result.value
  }

  /**
   * Set field values for an entity using RecordId
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Map of fieldId -> value
   */
  private async setFieldValues(recordId: RecordId, values: Record<string, unknown>): Promise<void> {
    const { entityDefinitionId } = parseRecordId(recordId)

    // Check if any key is a system field key (needs mapping to CustomField UUID)
    const needsMapping = Object.keys(values).some((key) => SYSTEM_FIELD_KEYS.has(key))

    let valueArray: Array<{ fieldId: string; value: unknown }>

    if (needsMapping) {
      // Build systemAttribute → CustomField.id map using cached fields
      const fields = await this.getCustomFieldsCached(entityDefinitionId)
      const sysAttrToIdMap = new Map(fields.map((f) => [f.systemAttribute ?? '', f.id]))

      valueArray = Object.entries(values)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => ({
          fieldId: sysAttrToIdMap.get(key) ?? key, // Map systemAttribute → UUID, or pass through
          value,
        }))
    } else {
      // Direct - keys are already field IDs
      valueArray = Object.entries(values)
        .filter(([_, value]) => value !== undefined)
        .map(([fieldId, value]) => ({ fieldId, value }))
    }

    if (valueArray.length > 0) {
      await this.fieldValueService.setValuesForEntity({
        recordId,
        values: valueArray,
      })
    }
  }

  private async invalidateSnapshots(entityDefinitionId: string): Promise<void> {
    try {
      await invalidateSnapshots({
        organizationId: this.organizationId,
        resourceType: entityDefinitionId,
      })
    } catch {
      // Non-critical
    }
  }

  private async publishEvent(
    action: 'created' | 'updated' | 'deleted',
    entityDef: EntityDefinitionEntity,
    instanceId: string,
    values: Record<string, unknown>,
    extra?: Record<string, unknown>
  ): Promise<void> {
    publisher.publishLater({
      type: `entity:${action}`,
      data: {
        instanceId,
        entityDefinitionId: entityDef.id,
        entitySlug: entityDef.apiSlug,
        entityType: entityDef.entityType,
        organizationId: this.organizationId,
        userId: this.userId,
        values,
        ...extra,
      },
    })
  }

  private async runPreHooks(
    operation: 'create' | 'update',
    entityDef: EntityDefinitionEntity,
    values: Record<string, unknown>,
    existingInstance?: EntityInstanceEntity
  ): Promise<Record<string, unknown>> {
    // Get entity-specific hooks and common hooks (run for ALL entities)
    const entityHooks = getSystemHooks(entityDef.entityType)
    const commonHooks = getCommonHooks()

    // Merge hooks: common hooks first, then entity-specific hooks
    // Entity-specific hooks can override common behavior if needed
    const mergedHooks: Record<string, typeof entityHooks[string]> = { ...commonHooks }
    for (const [attr, fns] of Object.entries(entityHooks)) {
      mergedHooks[attr] = [...(mergedHooks[attr] ?? []), ...fns]
    }

    let processedValues = { ...values }

    // Get all fields for the entity (needed for looking up related fields in hooks)
    const allFields = await this.getCustomFieldsCached(entityDef.id)

    for (const [systemAttribute, hookFns] of Object.entries(mergedHooks)) {
      // Find field with this systemAttribute
      const field = await this.getFieldBySystemAttribute(entityDef.id, systemAttribute)
      if (!field) continue

      // For create operations, always run hooks (allows auto-generation like ticket_number)
      // For update operations, only run hooks if the field is being updated
      if (operation === 'update' && !(field.id in processedValues)) continue

      for (const hook of hookFns) {
        processedValues = await hook({
          operation,
          entityDef,
          field,
          values: processedValues,
          existingInstance,
          organizationId: this.organizationId,
          userId: this.userId,
          allFields,
        })
      }
    }

    return processedValues
  }

  private async validateUniqueFields(
    entityDefinitionId: string,
    values: Record<string, unknown>,
    excludeEntityId?: string
  ): Promise<void> {
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    const uniqueFields = fields.filter((f) => f.isUnique)

    for (const field of uniqueFields) {
      const value = values[field.id]
      if (value === undefined || value === null || value === '') continue

      const result = await checkUniqueValue({
        fieldId: field.id,
        value,
        organizationId: this.organizationId,
        modelType: ModelTypes.ENTITY,
        entityDefinitionId,
        excludeEntityId,
      })

      if (result.isErr()) {
        throw new Error(`${field.name} must be unique: value already exists`)
      }
    }
  }

  private async getFieldBySystemAttribute(entityDefinitionId: string, systemAttribute: string) {
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    return fields.find((f) => f.systemAttribute === systemAttribute) ?? null
  }
}
