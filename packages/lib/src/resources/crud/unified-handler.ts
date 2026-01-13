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
import { toResourceId, parseResourceId, type ResourceId } from '../resource-id'
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
 * const resourceId = toResourceId('contact', contact.id)
 * await handler.update(resourceId, {
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

  constructor(
    private organizationId: string,
    private userId: string,
    db?: Database
  ) {
    this.db = db ?? defaultDatabase
    this.fieldValueService = new FieldValueService(organizationId, userId, this.db)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE RECORD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create entity instance with field values and system hooks
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param values - Field values to set (map of fieldId -> value)
   */
  async create(
    entityDefinitionId: string,
    values: Record<string, unknown>
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

    // Build ResourceId for field value operations
    const resourceId = toResourceId(entityDef.id, instance.id)

    // Set field values using ResourceId
    await this.setFieldValues(resourceId, processedValues)

    // Invalidate snapshots
    await this.invalidateSnapshots(entityDef.id)

    // Publish event
    await this.publishEvent('created', entityDef, instance.id, processedValues)

    return instance
  }

  /**
   * Update entity instance field values
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   * @param values - Field values to update (map of fieldId -> value)
   */
  async update(
    resourceId: ResourceId,
    values: Record<string, unknown>
  ): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    const instance = await this.getById(resourceId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Run pre-update hooks
    const processedValues = await this.runPreHooks('update', entityDef, values, instance)

    // Check uniqueness (excluding current entity)
    await this.validateUniqueFields(entityDef.id, processedValues, entityInstanceId)

    // Set field values using ResourceId
    await this.setFieldValues(resourceId, processedValues)

    // Invalidate snapshots
    await this.invalidateSnapshots(entityDef.id)

    // Publish event
    await this.publishEvent('updated', entityDef, entityInstanceId, processedValues)

    return (await this.getById(resourceId))!
  }

  /**
   * Get entity instance by ID
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   */
  async getById(resourceId: ResourceId): Promise<EntityInstanceEntity | null> {
    const { entityInstanceId } = parseResourceId(resourceId)
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

    const resourceId = toResourceId(entityDef.id, rows[0]!.entityId)
    return this.getById(resourceId)
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
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   */
  async archive(resourceId: ResourceId): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    const instance = await this.getById(resourceId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const updateResult = await updateEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
      data: { archivedAt: new Date().toISOString() },
    })

    unwrapResult(updateResult)

    await this.invalidateSnapshots(entityDef.id)
    await this.publishEvent('deleted', entityDef, entityInstanceId, {}, { hardDelete: false })

    return (await this.getById(resourceId))!
  }

  /**
   * Restore archived entity instance
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   */
  async restore(resourceId: ResourceId): Promise<EntityInstanceEntity> {
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    const instance = await this.getById(resourceId)
    if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    const updateResult = await updateEntityInstance({
      id: entityInstanceId,
      organizationId: this.organizationId,
      data: { archivedAt: null },
    })

    unwrapResult(updateResult)

    await this.invalidateSnapshots(entityDef.id)
    await this.publishEvent('updated', entityDef, entityInstanceId, {}, { restored: true })

    return (await this.getById(resourceId))!
  }

  /**
   * Permanently delete entity instance
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   */
  async delete(resourceId: ResourceId): Promise<void> {
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    const instance = await this.getById(resourceId)
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

    await this.invalidateSnapshots(entityDef.id)
    await this.publishEvent('deleted', entityDef, entityInstanceId, {}, { hardDelete: true })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bulk create entities
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param items - Array of field value maps to create
   */
  async bulkCreate(
    entityDefinitionId: string,
    items: Record<string, unknown>[]
  ): Promise<{ created: EntityInstanceEntity[]; errors: Array<{ index: number; error: string }> }> {
    const created: EntityInstanceEntity[] = []
    const errors: Array<{ index: number; error: string }> = []

    for (let i = 0; i < items.length; i++) {
      try {
        const instance = await this.create(entityDefinitionId, items[i]!)
        created.push(instance)
      } catch (e) {
        errors.push({ index: i, error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    return { created, errors }
  }

  /**
   * Bulk update entities
   *
   * @param updates - Array of { resourceId, values } to update
   */
  async bulkUpdate(
    updates: Array<{ resourceId: ResourceId; values: Record<string, unknown> }>
  ): Promise<{ updated: number; errors: Array<{ resourceId: ResourceId; error: string }> }> {
    let updated = 0
    const errors: Array<{ resourceId: ResourceId; error: string }> = []

    for (const { resourceId, values } of updates) {
      try {
        await this.update(resourceId, values)
        updated++
      } catch (e) {
        errors.push({ resourceId, error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    return { updated, errors }
  }

  /**
   * Bulk archive entities (soft delete)
   *
   * @param resourceIds - Array of ResourceIds to archive
   */
  async bulkArchive(resourceIds: ResourceId[]): Promise<{ count: number }> {
    let count = 0
    for (const resourceId of resourceIds) {
      try {
        await this.archive(resourceId)
        count++
      } catch {
        // Skip failures
      }
    }
    return { count }
  }

  /**
   * Bulk delete entities (hard delete)
   *
   * @param resourceIds - Array of ResourceIds to delete
   */
  async bulkDelete(resourceIds: ResourceId[]): Promise<{ count: number }> {
    let count = 0
    for (const resourceId of resourceIds) {
      try {
        await this.delete(resourceId)
        count++
      } catch {
        // Skip failures
      }
    }
    return { count }
  }

  /**
   * Bulk set field value across multiple entities
   *
   * @param resourceIds - Array of ResourceIds to update
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async bulkSetFieldValue(
    resourceIds: ResourceId[],
    fieldId: string,
    value: unknown
  ): Promise<{ count: number }> {
    if (resourceIds.length === 0) return { count: 0 }

    // Use FieldValueService.setBulkValues for efficient bulk operation
    const result = await this.fieldValueService.setBulkValues({
      resourceIds,
      values: [{ fieldId, value }],
    })

    // Get entityDefinitionId from first resourceId for invalidation
    const { entityDefinitionId } = parseResourceId(resourceIds[0]!)
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
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   * @param fieldId - Field ID to set
   * @param value - Value to set
   */
  async setFieldValue(
    resourceId: ResourceId,
    fieldId: string,
    value: unknown
  ): Promise<void> {
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
    const entityDef = await this.resolveEntityDefinition(entityDefinitionId)

    // Use FieldValueService with ResourceId (no modelType needed)
    await this.fieldValueService.setValueWithBuiltIn({
      resourceId,
      fieldId,
      value,
    })

    await this.invalidateSnapshots(entityDef.id)
    await this.publishEvent('updated', entityDef, entityInstanceId, { [fieldId]: value })
  }

  /**
   * Get field values for entity
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   * @param fieldIds - Optional array of field IDs to fetch
   */
  async getFieldValues(
    resourceId: ResourceId,
    fieldIds?: string[]
  ): Promise<Map<string, any>> {
    // Use FieldValueService with ResourceId
    return this.fieldValueService.getValues({ resourceId, fieldIds })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve entity definition by ID or system type
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   */
  private async resolveEntityDefinition(entityDefinitionId: string): Promise<EntityDefinitionEntity> {
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

      return rows[0]!
    }

    // Otherwise treat as UUID
    const result = await getEntityDefinition({
      id: entityDefinitionId,
      organizationId: this.organizationId,
    })

    return unwrapResult(result)
  }

  /**
   * Set field values for an entity using ResourceId
   *
   * @param resourceId - ResourceId in format "entityDefinitionId:instanceId"
   * @param values - Map of fieldId -> value
   */
  private async setFieldValues(
    resourceId: ResourceId,
    values: Record<string, unknown>
  ): Promise<void> {
    const valueArray = Object.entries(values)
      .filter(([_, value]) => value !== undefined)
      .map(([fieldId, value]) => ({ fieldId, value }))

    if (valueArray.length > 0) {
      // Use FieldValueService with ResourceId (no modelType needed - derived internally)
      await this.fieldValueService.setValuesForEntity({
        resourceId,
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
    const fields = await getCustomFields({
      organizationId: this.organizationId,
      modelType: ModelTypes.ENTITY,
      entityDefinitionId,
    })

    if (fields.isErr()) return

    const uniqueFields = fields.value.filter((f) => f.isUnique)

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
    const fields = await getCustomFields({
      organizationId: this.organizationId,
      modelType: ModelTypes.ENTITY,
      entityDefinitionId,
    })

    if (fields.isErr()) return null

    return fields.value.find((f) => f.systemAttribute === systemAttribute) ?? null
  }
}
