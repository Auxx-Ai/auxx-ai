// packages/lib/src/resources/crud/unified-handler.ts

import type { Database } from '@auxx/database'
import { database as defaultDatabase, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { checkUniqueValue } from '@auxx/services/custom-fields'
import { getEntityInstance, listEntityInstances } from '@auxx/services/entity-instances'
import { ModelTypes } from '@auxx/types/custom-field'
import { createTypedValueInput } from '@auxx/types/field-value'
import { isEntityDefinitionType } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { type AnyColumn, and, eq, type SQL } from 'drizzle-orm'
import { findCachedResource, getCachedCustomFields } from '../../cache'
import { type ConditionGroup, resolveConditionContext } from '../../conditions'
import { BadRequestError } from '../../errors'
import { publisher } from '../../events/publisher'
import { FieldValueService } from '../../field-values'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { typedColumnMatch } from '../../field-values/typed-column-match'
import { getOrCreateSnapshot, getSnapshotChunk, invalidateSnapshots } from '../../snapshot'
import { getCommonHooks, getSystemHooks } from '../hooks'
import { RecordPickerService } from '../picker'
import { isSystemResourceId } from '../registry'
import type { TableId } from '../registry/field-registry'
import { parseRecordId, type RecordId, toRecordId } from '../resource-id'
import type { ResolvedEntityDefinition } from './types'
import {
  archiveEntity,
  bulkArchiveEntities,
  bulkCreateEntities,
  bulkDeleteEntities,
  bulkSetFieldValue,
  bulkUpdateEntities,
  type CreateEntityResult,
  type CrudOptions,
  createEntity,
  createWithValues as createWithValuesImpl,
  deleteEntity,
  type MutationContext,
  mergeEntities,
  restoreEntity,
  updateEntity,
  updateValues as updateValuesImpl,
} from './unified-handler-mutations'
import {
  isSystemResource,
  type ListAllInput,
  type ListAllResult,
  type ListFilteredResult,
  listAll as listAllQuery,
  queryEntityInstanceIds,
  querySystemResourceIds,
  resolveEntityIdFromCache,
} from './unified-handler-queries'

/** Inferred type for CustomField select (not exported from schema) */
type CustomFieldEntity = typeof schema.CustomField.$inferSelect
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

const lookupLogger = createScopedLogger('unified-handler-lookup')

/**
 * Candidate for `lookupByField` — one `(systemAttribute, value)` pair to try.
 */
export type LookupCandidate = {
  systemAttribute: string
  value: unknown
}

/**
 * Single match returned by `lookupByField`. `matchedBy` records which
 * candidate hit this record (useful when callers want to know whether
 * dedup succeeded via externalId vs. primary_email).
 */
export type LookupMatch = {
  recordId: RecordId
  matchedBy: { systemAttribute: string; value: unknown }
}

/**
 * Result envelope for `lookupByField`. `hasMore` is set when the server
 * found more than `limit` distinct records across the candidate list.
 */
export type LookupByFieldResult = {
  items: LookupMatch[]
  hasMore: boolean
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
/** Optional construction options for `UnifiedCrudHandler`. */
export interface UnifiedCrudHandlerOptions {
  /**
   * SystemAttributes the caller is authorized to write even when a
   * registered field pre-hook would normally drop or reject them. Forwarded
   * to the internal `FieldValueService`.
   */
  bypassFieldGuards?: ReadonlySet<SystemAttribute>
}

export class UnifiedCrudHandler {
  fieldValueService: FieldValueService
  private db: Database
  private bypassFieldGuards: ReadonlySet<SystemAttribute>

  constructor(
    private organizationId: string,
    private userId: string,
    db?: Database,
    private socketId?: string,
    options: UnifiedCrudHandlerOptions = {}
  ) {
    this.db = db ?? defaultDatabase
    this.bypassFieldGuards = options.bypassFieldGuards ?? new Set()
    this.fieldValueService = new FieldValueService(organizationId, userId, this.db, socketId, {
      bypassFieldGuards: this.bypassFieldGuards,
    })
  }

  /**
   * Create mutation context for delegating to mutation functions
   */
  private getMutationContext(): MutationContext {
    return {
      db: this.db,
      organizationId: this.organizationId,
      userId: this.userId,
      socketId: this.socketId,
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
   * Now backed by org cache — triggers cache population if not already loaded.
   *
   * @param entityDefinitionId - Entity definition ID to cache
   */
  async warmCache(entityDefinitionId: string): Promise<void> {
    await this.resolveEntityDefinition(entityDefinitionId)
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
  async update(
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>,
    options: CrudOptions = {}
  ) {
    const { entityDefinitionId } = parseRecordId(recordId)
    await this.warmCache(entityDefinitionId)
    return updateEntity(this.getMutationContext(), recordId, values, modes, options)
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
   * Find entity by field value (e.g., find contact by email).
   * Back-compat wrapper around `lookupByField` — routes through the same
   * column-aware + normalization pipeline so callers (findOrCreate, etc.)
   * pick up EMAIL lowercasing, URL protocol normalization, etc. for free.
   *
   * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
   * @param fieldSystemAttribute - System attribute like 'primary_email'
   * @param value - Value to search for
   */
  async findByField(entityDefinitionId: string, fieldSystemAttribute: string, value: unknown) {
    const { items } = await this.lookupByField({
      entityDefinitionId,
      candidates: [{ systemAttribute: fieldSystemAttribute, value }],
      limit: 1,
    })
    if (items.length === 0) return null
    return this.getById(items[0]!.recordId)
  }

  /**
   * Build a typed equality condition on the right FieldValue column for a
   * given field + raw value. Returns `null` when the value can't be
   * coerced / normalized (uncoercible inputs like `Number('foo')` leak
   * through `createTypedValueInput` as NaN and would silently match zero
   * rows — gate explicitly instead).
   */
  private buildLookupCondition(field: CustomFieldEntity, rawValue: unknown): SQL | null {
    const normalized = normalizeForLookup(field.type as FieldType, rawValue)
    if (normalized === null || normalized === undefined) return null

    const typedInput = createTypedValueInput(field.type, normalized)
    if (typedInput === null) return null

    // `createTypedValueInput` does `Number(raw)` / `new Date(raw)` without
    // validating the result — gate explicitly.
    if (typedInput.type === 'number' && !Number.isFinite(typedInput.value)) return null
    if (typedInput.type === 'date' && Number.isNaN(new Date(typedInput.value).getTime())) {
      return null
    }

    const { column, value } = typedColumnMatch(typedInput)
    return eq(schema.FieldValue[column] as AnyColumn, value as string | number | boolean)
  }

  /**
   * Lookup record IDs by one or more `(systemAttribute, value)` candidates,
   * tried in priority order. Column-aware (routes through `typedColumnMatch`)
   * and value-normalizing (mirrors write-path formatting). Deduplicates hits
   * across candidates by recordId; the earliest-priority candidate wins
   * attribution.
   *
   * Candidate failure handling: a candidate whose field doesn't exist OR
   * whose value can't be coerced / normalized is **skipped with a warning
   * log**, not thrown. Only throws `BadRequestError` when ALL candidates
   * fail — otherwise one garbage input would take down a best-effort
   * fallback chain (e.g. externalId → email).
   *
   * Does not filter on archived records: re-capture of an archived contact
   * should link to the same row rather than create a duplicate. Callers
   * needing only-active records should post-filter via `record.getById`.
   *
   * Does not filter on `capabilities.hidden`: the extension is a system
   * integration and is allowed to address hidden fields (externalId).
   */
  async lookupByField(params: {
    entityDefinitionId: string
    candidates: LookupCandidate[]
    limit: number
  }): Promise<LookupByFieldResult> {
    const entityDef = await this.resolveEntityDefinition(params.entityDefinitionId)
    const seen = new Set<RecordId>()
    const items: LookupMatch[] = []
    let hasMore = false
    let anyValid = false
    const skipped: Array<{ candidate: LookupCandidate; reason: string }> = []

    for (const candidate of params.candidates) {
      if (items.length >= params.limit) break

      const field = await this.getFieldBySystemAttribute(entityDef.id, candidate.systemAttribute)
      if (!field) {
        skipped.push({ candidate, reason: 'field not found' })
        continue
      }

      const condition = this.buildLookupCondition(field, candidate.value)
      if (condition === null) {
        skipped.push({ candidate, reason: 'uncoercible value' })
        continue
      }
      anyValid = true

      // Fetch `remaining + 1` to detect hasMore. DISTINCT ON collapses
      // duplicate FieldValue rows on the same entity (e.g. belt-and-braces
      // against two rows with the same externalId after mode:'add' dedup).
      const remaining = params.limit - items.length
      const rows = await this.db
        .selectDistinctOn([schema.FieldValue.entityId], {
          entityId: schema.FieldValue.entityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.fieldId, field.id),
            eq(schema.FieldValue.organizationId, this.organizationId),
            condition
          )
        )
        .limit(remaining + 1)

      for (const row of rows) {
        const recordId = toRecordId(entityDef.id, row.entityId)
        if (seen.has(recordId)) continue
        if (items.length >= params.limit) {
          hasMore = true
          break
        }
        seen.add(recordId)
        items.push({
          recordId,
          matchedBy: { systemAttribute: candidate.systemAttribute, value: candidate.value },
        })
      }
    }

    if (!anyValid && params.candidates.length > 0) {
      throw new BadRequestError(
        `lookupByField: no candidate was valid. Skipped: ${JSON.stringify(skipped)}`
      )
    }
    if (skipped.length > 0) {
      lookupLogger.warn('lookupByField: skipped candidates', {
        entityDef: entityDef.id,
        skipped,
      })
    }

    return { items, hasMore }
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

    const result = await this.create(entityDefinitionId, { ...findBy, ...createValues })
    return { instance: result.instance, created: true }
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
  async bulkDelete(
    recordIds: RecordId[],
    options: CrudOptions = {}
  ): Promise<{ count: number; errors: Array<{ recordId: RecordId; message: string }> }> {
    if (recordIds.length === 0) return { count: 0, errors: [] }
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
   * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID.
   * Delegates to standalone function for reusability.
   *
   * @param params - Must provide either entityDefinitionId or apiSlug
   */
  async resolveEntityId(params: {
    entityDefinitionId?: string
    apiSlug?: string
  }): Promise<string> {
    return resolveEntityIdFromCache(this.organizationId, params)
  }

  /**
   * List all entities with field values for small datasets (no pagination).
   * Suitable for tags, inboxes, and other small entity collections.
   * Delegates to standalone function.
   *
   * @param params - List all parameters (entityDefinitionId or apiSlug required)
   */
  async listAll(params: ListAllInput): Promise<ListAllResult> {
    return listAllQuery(
      { db: this.db, organizationId: this.organizationId, userId: this.userId },
      params
    )
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
    const { entityDefinitionId, sorting = [], limit = 100, cursor } = params

    // Resolve valueSource placeholders (e.g. currentUser) before any cache key
    // is computed so snapshots are isolated per viewer.
    const filters = resolveConditionContext(params.filters ?? [], {
      currentUserId: this.userId,
    })

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

        // Resolve entity definition type (e.g. 'ticket', 'contact') to actual UUID
        const resolvedId = isEntityDefinitionType(entityDefinitionId)
          ? (await this.resolveEntityDefinition(entityDefinitionId)).id
          : entityDefinitionId

        return queryEntityInstanceIds({
          db: this.db,
          entityDefinitionId: resolvedId,
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
   * Search records with optional global search support.
   * Handles resolution of apiSlug and system entity names to actual entityDefinitionIds.
   *
   * @param params - Search parameters
   */
  async search(params: {
    query?: string
    apiSlug?: string
    entityDefinitionId?: string
    entityDefinitionIds?: string[]
    limit?: number
    cursor?: string
  }) {
    const { query, apiSlug, limit, cursor, entityDefinitionIds } = params
    let { entityDefinitionId } = params

    // Resolve apiSlug or entityDefinitionId to actual UUID via cache
    const key = apiSlug ?? entityDefinitionId
    if (key && !entityDefinitionId) {
      const resource = await findCachedResource(this.organizationId, key)
      entityDefinitionId = resource?.entityDefinitionId ?? resource?.id
    } else if (entityDefinitionId) {
      const resource = await findCachedResource(this.organizationId, entityDefinitionId)
      entityDefinitionId = resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId
    }

    // Also resolve entityDefinitionIds if provided
    let resolvedEntityDefinitionIds = entityDefinitionIds
    if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      resolvedEntityDefinitionIds = await Promise.all(
        entityDefinitionIds.map(async (id) => {
          const resource = await findCachedResource(this.organizationId, id)
          return resource?.entityDefinitionId ?? resource?.id ?? id
        })
      )
    }

    const service = new RecordPickerService(this.organizationId, this.userId, this.db)

    // System table types (thread, message, etc.) don't have EntityInstance rows.
    // Route to getResources() which queries the actual table via RESOURCE_TABLE_MAP.
    if (entityDefinitionId && isSystemResourceId(entityDefinitionId)) {
      const result = await service.getResources({
        entityDefinitionId,
        limit: limit ?? 25,
        cursor,
        search: query,
      })
      return {
        ...result,
        hasMore: !!result.nextCursor,
        processingTimeMs: 0,
        query: query ?? '',
      }
    }

    return service.search({
      query: query ?? '',
      entityDefinitionId,
      entityDefinitionIds: resolvedEntityDefinitionIds,
      limit,
      cursor,
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
   * Resolve entity definition by ID, entityType, or apiSlug.
   * Reads from the org `resources` cache — no DB fetch. Cache is invalidated
   * by the `entity-def.*` events in the invalidation graph.
   *
   * @param entityDefinitionId - 'contact', 'ticket', 'tag', apiSlug, or UUID
   * @returns Narrow `{ id, entityType, apiSlug }` — the only fields mutations and hooks consume
   */
  async resolveEntityDefinition(entityDefinitionId: string): Promise<ResolvedEntityDefinition> {
    const resource = await findCachedResource(this.organizationId, entityDefinitionId)
    if (!resource) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }
    return {
      id: resource.entityDefinitionId ?? resource.id,
      entityType: resource.entityType ?? null,
      apiSlug: resource.apiSlug ?? null,
    }
  }

  /**
   * Get custom fields for an entity definition from org cache
   *
   * @param entityDefinitionId - Entity definition UUID
   */
  private async getCustomFieldsCached(entityDefinitionId: string) {
    return getCachedCustomFields(this.organizationId, entityDefinitionId)
  }

  /**
   * Set field values for an entity using RecordId.
   *
   * @param recordId - RecordId in format "entityDefinitionId:instanceId"
   * @param values - Map of fieldId -> value
   * @param modes - Optional per-field write mode. Fields not listed default
   *   to `'set'`. `'add'` / `'remove'` route to the multi-value primitives;
   *   they throw `BadRequestError` on single-value fields.
   */
  private async setFieldValues(
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>
  ): Promise<void> {
    const { entityDefinitionId } = parseRecordId(recordId)

    // Get cached fields and build key → id map for all entity types
    // Uses systemAttribute (e.g., 'title', 'tag_parent') as key, falls back to name for custom fields
    const fields = await this.getCustomFieldsCached(entityDefinitionId)
    const keyToIdMap = new Map(fields.map((f) => [f.systemAttribute ?? f.name, f.id]))

    // Resolve each entry to (fieldId, value, mode) so we can bucket below.
    // Any key that doesn't match a known systemAttribute/name is passed
    // through as-is — callers sometimes address fields by UUID directly.
    type Entry = { key: string; fieldId: string; value: unknown; mode: 'set' | 'add' | 'remove' }
    const entries: Entry[] = []
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      const fieldId = keyToIdMap.get(key) ?? key
      // modes map is keyed the same way the caller keyed `values` — accept
      // either systemAttribute or UUID. Prefer an explicit UUID match so
      // callers mixing keys in one call still work.
      const mode = modes?.[key] ?? modes?.[fieldId] ?? 'set'
      entries.push({ key, fieldId, value, mode })
    }

    const setEntries = entries.filter((e) => e.mode === 'set')
    const addEntries = entries.filter((e) => e.mode === 'add')
    const removeEntries = entries.filter((e) => e.mode === 'remove')

    if (setEntries.length > 0) {
      await this.fieldValueService.setValuesForEntity({
        recordId,
        values: setEntries.map((e) => ({ fieldId: e.fieldId, value: e.value })),
      })
    }

    for (const e of addEntries) {
      await this.fieldValueService.addValues({
        recordId,
        fieldId: e.fieldId,
        values: Array.isArray(e.value) ? e.value : [e.value],
      })
    }

    for (const e of removeEntries) {
      await this.fieldValueService.removeValues({
        recordId,
        fieldId: e.fieldId,
        values: Array.isArray(e.value) ? e.value : [e.value],
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
    entityDef: ResolvedEntityDefinition,
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
    entityDef: ResolvedEntityDefinition,
    values: Record<string, unknown>,
    existingInstance?: EntityInstanceEntity
  ): Promise<Record<string, unknown>> {
    // Get entity-specific hooks and common hooks (run for ALL entities)
    const entityHooks = getSystemHooks(entityDef.entityType)
    const commonHooks = getCommonHooks()

    // Merge hooks: common hooks first, then entity-specific hooks
    // Entity-specific hooks can override common behavior if needed
    const mergedHooks: Record<string, (typeof entityHooks)[string]> = { ...commonHooks }
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
