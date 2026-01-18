// packages/lib/src/resources/crud/unified-handler.ts

import type { Result } from 'neverthrow'
import type { Database } from '@auxx/database'
import { database as defaultDatabase, schema } from '@auxx/database'
import { eq, and, ne, sql } from 'drizzle-orm'
import {
  createEntityInstance,
  getEntityInstance,
  listEntityInstances,
  updateEntityInstance,
  deleteEntityInstance,
} from '@auxx/services/entity-instances'
import { getEntityDefinition } from '@auxx/services/entity-definitions'
import { getCustomFields, checkUniqueValue } from '@auxx/services/custom-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import { FieldValueService } from '../../field-values'
import { publisher } from '../../events/publisher'
import { CommentService } from '../../comments'
import { invalidateSnapshots } from '../../snapshot'
import { toRecordId, parseRecordId, type RecordId } from '../resource-id'
import { getSystemHooks } from '../hooks'
import type { EntityDefinitionEntity } from '@auxx/database/schema/entity-definition'
import type { CustomFieldEntity } from '@auxx/database/schema/custom-field'
import type { EntityInstanceEntity } from '@auxx/database/schema/entity-instance'

/**
 * Helper to unwrap neverthrow Result and throw on error
 */
function unwrapResult<T, E extends { message: string }>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(result.error.message)
  }
  return result.value
}

/**
 * Options for CRUD operations
 */
export interface CrudOptions {
  /** Skip event publishing (for bulk imports) */
  skipEvents?: boolean
  /** Skip snapshot invalidation (caller will invalidate once at end) */
  skipSnapshotInvalidation?: boolean
}

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
   * Create entity instance with field values and system hooks
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param values - Field values to set (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async create(
    entityDefinitionId: string,
    values: Record<string, unknown>,
    options: CrudOptions = {}
  ): Promise<EntityInstanceEntity> {
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Run pre-create hooks (validation, normalization)
    const processedValues = await this.runPreHooks('create', entityDef, values)

    // Check uniqueness constraints
    await this.validateUniqueFields(entityDef.id, processedValues)

    // Create EntityInstance
    const instanceResult = await createEntityInstance({
      entityDefinitionId: entityDef.id,
      organizationId: this.organizationId,
      createdById: this.userId,
    })

    const instance = unwrapResult(instanceResult)

    // Build RecordId for field value operations
    const recordId = toRecordId(entityDef.id, instance.id)

    // Set field values using RecordId
    await this.setFieldValues(recordId, processedValues)

    // Invalidate snapshots (unless skipped for bulk operations)
    if (!options.skipSnapshotInvalidation) {
      await this.invalidateSnapshots(entityDef.id)
    }

    // Publish event (unless skipped for bulk imports)
    if (!options.skipEvents) {
      await this.publishEvent('created', entityDef, instance.id, processedValues)
    }

    return instance
  }

  /**
   * Update entity instance field values
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Field values to update (map of fieldId -> value)
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async update(
    recordId: RecordId,
    values: Record<string, unknown>,
    options: CrudOptions = {}
  ): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

    // Single fetch to verify existence
    const instance = await this.getById(recordId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Run pre-update hooks
    const processedValues = await this.runPreHooks('update', entityDef, values, instance)

    // Check uniqueness (excluding current entity)
    await this.validateUniqueFields(entityDef.id, processedValues, entityInstanceId)

    // Set field values using RecordId
    await this.setFieldValues(recordId, processedValues)

    // Invalidate snapshots (unless skipped for bulk operations)
    if (!options.skipSnapshotInvalidation) {
      await this.invalidateSnapshots(entityDef.id)
    }

    // Publish event (unless skipped for bulk imports)
    if (!options.skipEvents) {
      await this.publishEvent('updated', entityDef, entityInstanceId, processedValues)
    }

    // Return the instance we already fetched (field values are in FieldValue table, not on instance)
    return instance
  }

  /**
   * Get entity instance by ID
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   */
  async getById(recordId: RecordId): Promise<EntityInstanceEntity | null> {
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
  async findByField(
    entityDefinitionId: string,
    fieldSystemAttribute: string,
    value: unknown
  ): Promise<EntityInstanceEntity | null> {
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
  async archive(recordId: RecordId, options: CrudOptions = {}): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

    const instance = await this.getById(recordId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const updateResult = await updateEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
      data: { archivedAt: new Date().toISOString() },
    })

    unwrapResult(updateResult)

    if (!options.skipSnapshotInvalidation) {
      await this.invalidateSnapshots(entityDef.id)
    }
    if (!options.skipEvents) {
      await this.publishEvent('deleted', entityDef, entityInstanceId, {}, { hardDelete: false })
    }

    // Return the instance we already fetched (archivedAt is the only change)
    return { ...instance, archivedAt: new Date() }
  }

  /**
   * Restore archived entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async restore(recordId: RecordId, options: CrudOptions = {}): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

    const instance = await this.getById(recordId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const updateResult = await updateEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
      data: { archivedAt: null },
    })

    unwrapResult(updateResult)

    if (!options.skipSnapshotInvalidation) {
      await this.invalidateSnapshots(entityDef.id)
    }
    if (!options.skipEvents) {
      await this.publishEvent('updated', entityDef, entityInstanceId, {}, { restored: true })
    }

    // Return the instance we already fetched with archivedAt cleared
    return { ...instance, archivedAt: null }
  }

  /**
   * Permanently delete entity instance
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async delete(recordId: RecordId, options: CrudOptions = {}): Promise<void> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

    const instance = await this.getById(recordId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Delete comments
    const commentService = new CommentService(this.organizationId, this.userId, this.db)
    await commentService.deleteCommentsByEntity(entityInstanceId, entityDef.id)

    const deleteResult = await deleteEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
    })

    unwrapResult(deleteResult)

    if (!options.skipSnapshotInvalidation) {
      await this.invalidateSnapshots(entityDef.id)
    }
    if (!options.skipEvents) {
      await this.publishEvent('deleted', entityDef, entityInstanceId, {}, { hardDelete: true })
    }
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

    // Pre-warm caches once for all records
    await this.warmCache(entityDefinitionId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const created: EntityInstanceEntity[] = []
    const errors: Array<{ index: number; error: string }> = []

    // Create all records without individual snapshot invalidation
    for (let i = 0; i < items.length; i++) {
      try {
        const instance = await this.create(entityDefinitionId, items[i]!, {
          skipEvents: options.skipEvents,
          skipSnapshotInvalidation: true, // Always skip - we'll do it once at end
        })
        created.push(instance)
      } catch (e) {
        errors.push({ index: i, error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    // Single snapshot invalidation at end (unless caller skipped it)
    if (!options.skipSnapshotInvalidation && created.length > 0) {
      await this.invalidateSnapshots(entityDef.id)
    }

    return { created, errors }
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

    // Pre-warm cache for the first entity's definition (assumes all are same type)
    const { entityDefinitionId } = parseRecordId(updates[0]!.recordId)
    await this.warmCache(entityDefinitionId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    let updated = 0
    const errors: Array<{ recordId: RecordId; error: string }> = []

    // Update all records without individual snapshot invalidation
    for (const { recordId, values } of updates) {
      try {
        await this.update(recordId, values, {
          skipEvents: options.skipEvents,
          skipSnapshotInvalidation: true, // Always skip - we'll do it once at end
        })
        updated++
      } catch (e) {
        errors.push({ recordId, error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    // Single snapshot invalidation at end (unless caller skipped it)
    if (!options.skipSnapshotInvalidation && updated > 0) {
      await this.invalidateSnapshots(entityDef.id)
    }

    return { updated, errors }
  }

  /**
   * Bulk archive entities (soft delete)
   *
   * @param recordIds - Array of RecordIds to archive
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkArchive(recordIds: RecordId[], options: CrudOptions = {}): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }

    // Pre-warm cache for the first entity's definition (assumes all are same type)
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    let count = 0
    for (const recordId of recordIds) {
      try {
        await this.archive(recordId, {
          skipEvents: options.skipEvents,
          skipSnapshotInvalidation: true, // Always skip - we'll do it once at end
        })
        count++
      } catch {
        // Skip failures
      }
    }

    // Single snapshot invalidation at end (unless caller skipped it)
    if (!options.skipSnapshotInvalidation && count > 0) {
      await this.invalidateSnapshots(entityDef.id)
    }

    return { count }
  }

  /**
   * Bulk delete entities (hard delete)
   *
   * @param recordIds - Array of RecordIds to delete
   * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
   */
  async bulkDelete(recordIds: RecordId[], options: CrudOptions = {}): Promise<{ count: number }> {
    if (recordIds.length === 0) return { count: 0 }

    // Pre-warm cache for the first entity's definition (assumes all are same type)
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.warmCache(entityDefinitionId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    let count = 0
    for (const recordId of recordIds) {
      try {
        await this.delete(recordId, {
          skipEvents: options.skipEvents,
          skipSnapshotInvalidation: true, // Always skip - we'll do it once at end
        })
        count++
      } catch {
        // Skip failures
      }
    }

    // Single snapshot invalidation at end (unless caller skipped it)
    if (!options.skipSnapshotInvalidation && count > 0) {
      await this.invalidateSnapshots(entityDef.id)
    }

    return { count }
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

    // Use FieldValueService.setBulkValues for efficient bulk operation
    const result = await this.fieldValueService.setBulkValues({
      recordIds,
      values: [{ fieldId, value }],
    })

    // Get entityDefinitionId from first recordId for invalidation
    const { entityDefinitionId } = parseRecordId(recordIds[0]!)
    await this.invalidateSnapshots(entityDefinitionId)

    return { count: result.count }
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
  async setFieldValue(
    recordId: RecordId,
    fieldId: string,
    value: unknown
  ): Promise<void> {
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
  async getFieldValues(
    recordId: RecordId,
    fieldIds?: string[]
  ): Promise<Map<string, any>> {
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
  private async resolveEntityDefinition(entityDefinitionId: string): Promise<EntityDefinitionEntity> {
    // Check cache first
    const cached = this.entityDefCache.get(entityDefinitionId)
    if (cached) return cached

    let entityDef: EntityDefinitionEntity

    // System types map to entityType column - query by entityType
    if (['contact', 'ticket', 'part', 'entity_group'].includes(entityDefinitionId)) {
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
  private async getCustomFieldsCached(entityDefinitionId: string): Promise<CustomFieldEntity[]> {
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
  private async setFieldValues(
    recordId: RecordId,
    values: Record<string, unknown>
  ): Promise<void> {
    const valueArray = Object.entries(values)
      .filter(([_, value]) => value !== undefined)
      .map(([fieldId, value]) => ({ fieldId, value }))

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
    const hooks = getSystemHooks(entityDef.entityType)
    let processedValues = { ...values }

    for (const [systemAttribute, hookFns] of Object.entries(hooks)) {
      // Find field with this systemAttribute
      const field = await this.getFieldBySystemAttribute(entityDef.id, systemAttribute)
      if (!field || !(field.id in processedValues)) continue

      for (const hook of hookFns) {
        processedValues = await hook({
          operation,
          entityDef,
          field,
          values: processedValues,
          existingInstance,
          organizationId: this.organizationId,
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

  private async getFieldBySystemAttribute(
    entityDefinitionId: string,
    systemAttribute: string
  ): Promise<CustomFieldEntity | null> {
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    return fields.find((f) => f.systemAttribute === systemAttribute) ?? null
  }
}
