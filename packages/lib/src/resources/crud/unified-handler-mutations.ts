// packages/lib/src/resources/crud/unified-handler-mutations.ts

import { type Database, schema } from '@auxx/database'
import {
  createEntityInstance,
  getEntityInstance,
  updateEntityInstance,
  deleteEntityInstance,
} from '@auxx/services/entity-instances'
import { FieldValueService } from '../../field-values'
import { publisher } from '../../events/publisher'
import { CommentService } from '../../comments'
import { invalidateSnapshots } from '../../snapshot'
import { toRecordId, parseRecordId, type RecordId } from '../resource-id'
import { EntityMergeService } from '../merge'
import type { MergeEntitiesResult } from '../merge'
// import type { EntityDefinitionEntity } from '@auxx/database/schema/entity-definition'
// import type { EntityInstanceEntity } from '@auxx/database/schema/entity-instance'
type EntityDefinitionEntity = typeof schema.EntityDefinition.$inferSelect
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

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
 * Context for mutation operations
 * Provides access to common services and organization context
 */
export interface MutationContext {
  db: Database
  organizationId: string
  userId: string
  fieldValueService: FieldValueService
  resolveEntityDefinition: (entityDefinitionId: string) => Promise<EntityDefinitionEntity>
  runPreHooks: (
    operation: 'create' | 'update',
    entityDef: EntityDefinitionEntity,
    values: Record<string, unknown>,
    existingInstance?: EntityInstanceEntity
  ) => Promise<Record<string, unknown>>
  validateUniqueFields: (
    entityDefinitionId: string,
    values: Record<string, unknown>,
    excludeEntityId?: string
  ) => Promise<void>
  setFieldValues: (recordId: RecordId, values: Record<string, unknown>) => Promise<void>
}

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

/**
 * Publish entity event
 */
async function publishEvent(
  action: 'created' | 'updated' | 'deleted',
  entityDef: EntityDefinitionEntity,
  instanceId: string,
  values: Record<string, unknown>,
  organizationId: string,
  userId: string,
  extra?: Record<string, unknown>
): Promise<void> {
  publisher.publishLater({
    type: `entity:${action}`,
    data: {
      instanceId,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      entityType: entityDef.entityType,
      organizationId,
      userId,
      values,
      ...extra,
    },
  })
}

/**
 * Invalidate snapshots for an entity definition
 */
async function invalidateEntitySnapshots(
  organizationId: string,
  entityDefinitionId: string
): Promise<void> {
  try {
    await invalidateSnapshots({
      organizationId,
      resourceType: entityDefinitionId,
    })
  } catch {
    // Non-critical
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE RECORD MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create entity instance with field values and system hooks
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
 * @param values - Field values to set (map of fieldId -> value)
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function createEntity(
  ctx: MutationContext,
  entityDefinitionId: string,
  values: Record<string, unknown>,
  options: CrudOptions = {}
) {
  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Run pre-create hooks (validation, normalization)
  const processedValues = await ctx.runPreHooks('create', entityDef, values)

  // Check uniqueness constraints
  await ctx.validateUniqueFields(entityDef.id, processedValues)

  // Create EntityInstance
  const instanceResult = await createEntityInstance({
    entityDefinitionId: entityDef.id,
    organizationId: ctx.organizationId,
    createdById: ctx.userId,
  })

  const instance = unwrapResult(instanceResult)

  // Build RecordId for field value operations
  const recordId = toRecordId(entityDef.id, instance.id)

  // Set field values using RecordId
  await ctx.setFieldValues(recordId, processedValues)

  // Invalidate snapshots (unless skipped for bulk operations)
  if (!options.skipSnapshotInvalidation) {
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  // Publish event (unless skipped for bulk imports)
  if (!options.skipEvents) {
    await publishEvent(
      'created',
      entityDef,
      instance.id,
      processedValues,
      ctx.organizationId,
      ctx.userId
    )
  }

  return instance
}

/**
 * Update entity instance field values
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param values - Field values to update (map of fieldId -> value)
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function updateEntity(
  ctx: MutationContext,
  recordId: RecordId,
  values: Record<string, unknown>,
  options: CrudOptions = {}
) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Single fetch to verify existence
  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Run pre-update hooks
  const processedValues = await ctx.runPreHooks('update', entityDef, values, instance)

  // Check uniqueness (excluding current entity)
  await ctx.validateUniqueFields(entityDef.id, processedValues, entityInstanceId)

  // Set field values using RecordId
  await ctx.setFieldValues(recordId, processedValues)

  // Invalidate snapshots (unless skipped for bulk operations)
  if (!options.skipSnapshotInvalidation) {
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  // Publish event (unless skipped for bulk imports)
  if (!options.skipEvents) {
    await publishEvent(
      'updated',
      entityDef,
      entityInstanceId,
      processedValues,
      ctx.organizationId,
      ctx.userId
    )
  }

  // Return the instance we already fetched (field values are in FieldValue table, not on instance)
  return instance
}

/**
 * Archive entity instance (soft delete)
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function archiveEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions = {}
) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  const updateResult = await updateEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
    data: { archivedAt: new Date() },
  })

  unwrapResult(updateResult)

  if (!options.skipSnapshotInvalidation) {
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }
  if (!options.skipEvents) {
    await publishEvent('deleted', entityDef, entityInstanceId, {}, ctx.organizationId, ctx.userId, {
      hardDelete: false,
    })
  }

  // Return the instance we already fetched (archivedAt is the only change)
  return { ...instance, archivedAt: new Date() }
}

/**
 * Restore archived entity instance
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function restoreEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions = {}
) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  const updateResult = await updateEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
    data: { archivedAt: null },
  })

  unwrapResult(updateResult)

  if (!options.skipSnapshotInvalidation) {
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }
  if (!options.skipEvents) {
    await publishEvent('updated', entityDef, entityInstanceId, {}, ctx.organizationId, ctx.userId, {
      restored: true,
    })
  }

  // Return the instance we already fetched with archivedAt cleared
  return { ...instance, archivedAt: null }
}

/**
 * Permanently delete entity instance
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function deleteEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions = {}
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Delete comments using RecordId
  const commentService = new CommentService(ctx.organizationId, ctx.userId, ctx.db)
  await commentService.deleteCommentsByRecordId(recordId)

  const deleteResult = await deleteEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })

  unwrapResult(deleteResult)

  if (!options.skipSnapshotInvalidation) {
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }
  if (!options.skipEvents) {
    await publishEvent('deleted', entityDef, entityInstanceId, {}, ctx.organizationId, ctx.userId, {
      hardDelete: true,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bulk create entities
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
 * @param items - Array of field value maps to create
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function bulkCreateEntities(
  ctx: MutationContext,
  entityDefinitionId: string,
  items: Record<string, unknown>[],
  options: CrudOptions = {}
): Promise<{ created: EntityInstanceEntity[]; errors: Array<{ index: number; error: string }> }> {
  if (items.length === 0) return { created: [], errors: [] }

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  const created: EntityInstanceEntity[] = []
  const errors: Array<{ index: number; error: string }> = []

  // Create all records without individual snapshot invalidation
  for (let i = 0; i < items.length; i++) {
    try {
      const instance = await createEntity(ctx, entityDefinitionId, items[i]!, {
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
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  return { created, errors }
}

/**
 * Bulk update entities
 *
 * @param ctx - Mutation context
 * @param updates - Array of { recordId, values } to update
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function bulkUpdateEntities(
  ctx: MutationContext,
  updates: Array<{ recordId: RecordId; values: Record<string, unknown> }>,
  options: CrudOptions = {}
): Promise<{ updated: number; errors: Array<{ recordId: RecordId; error: string }> }> {
  if (updates.length === 0) return { updated: 0, errors: [] }

  // Get entityDefinitionId from first recordId for invalidation
  const { entityDefinitionId } = parseRecordId(updates[0]!.recordId)
  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  let updated = 0
  const errors: Array<{ recordId: RecordId; error: string }> = []

  // Update all records without individual snapshot invalidation
  for (const { recordId, values } of updates) {
    try {
      await updateEntity(ctx, recordId, values, {
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
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  return { updated, errors }
}

/**
 * Bulk archive entities (soft delete)
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to archive
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function bulkArchiveEntities(
  ctx: MutationContext,
  recordIds: RecordId[],
  options: CrudOptions = {}
): Promise<{ count: number }> {
  if (recordIds.length === 0) return { count: 0 }

  // Get entityDefinitionId from first recordId for invalidation
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  let count = 0
  for (const recordId of recordIds) {
    try {
      await archiveEntity(ctx, recordId, {
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
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  return { count }
}

/**
 * Bulk delete entities (hard delete)
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to delete
 * @param options - Optional CRUD options (skipEvents, skipSnapshotInvalidation)
 */
export async function bulkDeleteEntities(
  ctx: MutationContext,
  recordIds: RecordId[],
  options: CrudOptions = {}
): Promise<{ count: number }> {
  if (recordIds.length === 0) return { count: 0 }

  // Get entityDefinitionId from first recordId for invalidation
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  let count = 0
  for (const recordId of recordIds) {
    try {
      await deleteEntity(ctx, recordId, {
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
    await invalidateEntitySnapshots(ctx.organizationId, entityDef.id)
  }

  return { count }
}

/**
 * Bulk set field value across multiple entities
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to update
 * @param fieldId - Field ID to set
 * @param value - Value to set
 */
export async function bulkSetFieldValue(
  ctx: MutationContext,
  recordIds: RecordId[],
  fieldId: string,
  value: unknown
): Promise<{ count: number }> {
  if (recordIds.length === 0) return { count: 0 }

  // Use FieldValueService.setBulkValues for efficient bulk operation
  const result = await ctx.fieldValueService.setBulkValues({
    recordIds,
    values: [{ fieldId, value }],
  })

  // Get entityDefinitionId from first recordId for invalidation
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  await invalidateEntitySnapshots(ctx.organizationId, entityDefinitionId)

  return { count: result.count }
}

// ═══════════════════════════════════════════════════════════════════════════
// MERGE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge multiple entity instances into a single target
 * Delegates to EntityMergeService for actual merge logic
 *
 * @param ctx - Mutation context
 * @param targetRecordId - RecordId of the target instance
 * @param sourceRecordIds - RecordIds of instances to merge into target
 */
export async function mergeEntities(
  ctx: MutationContext,
  targetRecordId: RecordId,
  sourceRecordIds: RecordId[]
): Promise<MergeEntitiesResult> {
  const mergeService = new EntityMergeService(ctx.db, ctx.organizationId, ctx.userId)
  return mergeService.merge({ targetRecordId, sourceRecordIds })
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW-COMPATIBLE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create entity instance with field values (workflow-compatible)
 * Wraps createEntity() to match EntityInstanceService.createWithValues() signature
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - Entity definition ID
 * @param values - Field values (fieldId -> value)
 */
export async function createWithValues(
  ctx: MutationContext,
  entityDefinitionId: string,
  values: Record<string, unknown>
): Promise<{ entityInstance: EntityInstanceEntity; id: string }> {
  const instance = await createEntity(ctx, entityDefinitionId, values)
  return { entityInstance: instance, id: instance.id }
}

/**
 * Update entity instance field values (workflow-compatible)
 * Wraps updateEntity() to match EntityInstanceService.updateValues() signature
 *
 * @param ctx - Mutation context
 * @param instanceId - Entity instance ID (not RecordId)
 * @param values - Field values to update (fieldId -> value)
 */
export async function updateValues(
  ctx: MutationContext,
  instanceId: string,
  values: Record<string, unknown>
): Promise<{ entityInstance: EntityInstanceEntity; id: string }> {
  // Need entityDefinitionId - fetch from instance first
  const instanceResult = await getEntityInstance({
    id: instanceId,
    organizationId: ctx.organizationId,
  })
  if (instanceResult.isErr()) {
    throw new Error(`Entity not found: ${instanceId}`)
  }

  const recordId = toRecordId(instanceResult.value.entityDefinitionId, instanceId)
  const updated = await updateEntity(ctx, recordId, values)
  return { entityInstance: updated, id: updated.id }
}
