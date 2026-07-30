// packages/lib/src/resources/picker/record-picker-service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isEntityDefinitionType, type RecordId } from '@auxx/types/resource'
import { and, asc, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import {
  getCachedEntityDefId,
  getCachedResource,
  getCachedResources,
  getOrgCache,
} from '../../cache'
import { getRecordIdentitiesForRecords } from '../../identity'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { isDeclaredInstanceDomain } from '../../permissions/capabilities/instance-access'
import {
  type RecordVisibilityScope,
  recordAccessRankSql,
  recordScopeArmFor,
  recordSearchVisibilitySql,
  recordUnionVisibilitySql,
  resolveRecordVisibilityScope,
} from '../../permissions/capabilities/record-visibility-scope'
import { resolveResourceAccessGrantees } from '../../resource-access/grantee-resolution'
import { isMailSharingDef } from '../../resource-access/mail-sharing-defs'
import {
  type CustomResource,
  isCustomResource,
  isCustomResourceId,
  RESOURCE_DISPLAY_CONFIG,
  RESOURCE_TABLE_MAP,
  type ResourceDisplayConfig,
  type TableId,
} from '../registry'
import { parseRecordId, toRecordId } from '../resource-id'
import { RecordPickerCacheService } from './record-picker-cache'
import type {
  GetResourceByIdInput,
  GetResourcesInput,
  GlobalSearchParams,
  GlobalSearchResult,
  PaginatedResourcesResult,
  RecordPickerItem,
  RecordSourceChip,
} from './types'

const logger = createScopedLogger('record-picker-service')

/**
 * Resolve display fields for EntityInstance-backed picker items.
 * If the primary displayName is missing, promote secondaryDisplayValue into
 * the primary slot (and leave secondary empty). Falls back to the id when
 * both are absent. Trims whitespace so blank strings count as missing.
 */
function resolveEntityDisplay(
  displayName: string | null,
  secondary: string | null,
  id: string
): { displayName: string; secondaryInfo: string | undefined } {
  const name = displayName?.trim()
  const sec = secondary?.trim()
  if (name) {
    return { displayName: name, secondaryInfo: sec || undefined }
  }
  return { displayName: sec || id, secondaryInfo: undefined }
}

/**
 * Generic record picker service
 * Works with any table defined in RESOURCE_TABLE_REGISTRY
 * Handles both direct and join-based organization scoping
 */
export class RecordPickerService {
  private db: Database
  private organizationId: string
  private userId?: string
  private cache: RecordPickerCacheService
  /** Request-scoped read enforcement (§2.2); undefined for internal callers. */
  private capabilities?: CapabilityView
  /** Per-service memo of {@link recordScope}, keyed by canonical def id. */
  private scopeCache = new Map<string, Promise<RecordVisibilityScope>>()

  constructor(
    organizationId: string,
    userId: string | undefined,
    db: Database,
    capabilities?: CapabilityView
  ) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
    this.cache = new RecordPickerCacheService()
    this.capabilities = capabilities
  }

  /**
   * Get paginated resources for picker
   * Supports both system resources (TableId) and custom entities (UUID-based)
   */
  async getResources(input: GetResourcesInput): Promise<PaginatedResourcesResult> {
    const { entityDefinitionId, limit, cursor, search, filters, skipCache } = input

    // Check if it's a custom entity (UUID-based entityDefinitionId)
    if (isCustomResourceId(entityDefinitionId)) {
      const resource = await getCachedResource(this.organizationId, entityDefinitionId)
      if (!resource || !isCustomResource(resource)) {
        throw new Error(`Unknown resource: ${entityDefinitionId}`)
      }
      return this.getEntityInstances(resource, limit, cursor, search)
    }

    // Validate table exists in registry for system resources
    if (!RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) {
      throw new Error(`Unknown table: ${entityDefinitionId}`)
    }

    // Check cache first
    if (!skipCache) {
      const cached = await this.cache.getCachedResources(this.organizationId, entityDefinitionId, {
        cursor,
        search,
        filters,
      })
      if (cached) {
        logger.debug('Cache hit', { entityDefinitionId, cursor, search })
        return cached
      }
    }

    // Fetch from database
    const result = await this.fetchResourcesFromDb(
      entityDefinitionId as TableId,
      limit,
      cursor,
      search,
      filters
    )

    // Cache result
    await this.cache.cacheResources(this.organizationId, entityDefinitionId, result, {
      cursor,
      search,
      filters,
    })

    return result
  }

  /**
   * Get single resource by ID
   * Supports both system resources (TableId) and custom entities (UUID-based)
   */
  async getResourceById(input: GetResourceByIdInput): Promise<RecordPickerItem | null> {
    const { entityDefinitionId, id } = input

    // Check if it's a custom entity (UUID-based entityDefinitionId)
    if (isCustomResourceId(entityDefinitionId)) {
      const resource = await getCachedResource(this.organizationId, entityDefinitionId)
      if (!resource || !isCustomResource(resource)) {
        return null
      }
      return this.getEntityInstanceById(resource, id)
    }

    // Validate table for system resources
    if (!RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) {
      throw new Error(`Unknown table: ${entityDefinitionId}`)
    }

    // Check cache
    const cached = await this.cache.getCachedSingleResource(
      this.organizationId,
      entityDefinitionId,
      id
    )
    if (cached) {
      logger.debug('Cache hit for single item', { entityDefinitionId, id })
      return cached
    }

    // Fetch from database
    const item = await this.fetchSingleResourceFromDb(entityDefinitionId as TableId, id)

    if (item) {
      await this.cache.cacheSingleResource(this.organizationId, entityDefinitionId, item)
    }

    return item
  }

  /**
   * Fetch resources from database using registry config
   * Handles both direct and join-based organization scoping
   */
  private async fetchResourcesFromDb(
    tableId: TableId,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, any> | undefined
  ): Promise<PaginatedResourcesResult> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
    const tableName = tableConfig.dbName

    // Get Drizzle table reference
    const table = schema[tableName as keyof typeof schema]

    // Determine organization scoping strategy
    const scopingStrategy = displayConfig.orgScopingStrategy || 'direct'

    // Build query based on scoping strategy
    if (scopingStrategy === 'join' && displayConfig.joinScoping) {
      return this.fetchResourcesWithJoin(
        tableId,
        table,
        displayConfig,
        limit,
        cursor,
        search,
        filters
      )
    } else {
      return this.fetchResourcesDirect(
        tableId,
        table,
        displayConfig,
        limit,
        cursor,
        search,
        filters
      )
    }
  }

  /**
   * Fetch resources with direct organization scoping (has organizationId column)
   * Uses Drizzle's relational query API (db.query.TableName.findMany())
   */
  private async fetchResourcesDirect(
    tableId: TableId,
    table: any,
    displayConfig: ResourceDisplayConfig,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, any> | undefined
  ): Promise<PaginatedResourcesResult> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const tableName = tableConfig.dbName
    const sortField = displayConfig.defaultSortField || 'updatedAt'
    const sortDirection = displayConfig.defaultSortDirection || 'desc'

    // Execute query using relational API
    const items = await this.db.query[tableName].findMany({
      where: (table, { eq, and, or, ilike, inArray, gt, lt }) => {
        const conditions: SQL[] = []

        // Organization scoping
        if ('organizationId' in table) {
          conditions.push(eq(table.organizationId, this.organizationId))
        }

        // Cursor pagination
        if (cursor) {
          const [sortValue, id] = cursor.split('|')
          if (sortValue && id) {
            const comparison = sortDirection === 'desc' ? lt : gt

            conditions.push(
              or(
                comparison(table[sortField], sortValue),
                and(eq(table[sortField], sortValue), comparison(table.id, id))
              )!
            )
          }
        }

        // Search across configured fields
        if (search?.trim()) {
          const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
            ilike(table[fieldKey], `%${search.trim()}%`)
          )
          if (searchConditions.length > 0) {
            conditions.push(or(...searchConditions)!)
          }
        }

        // Apply custom filters
        if (filters) {
          Object.entries(filters).forEach(([fieldKey, value]) => {
            if (value !== undefined && value !== null && table[fieldKey]) {
              if (Array.isArray(value)) {
                conditions.push(inArray(table[fieldKey], value))
              } else {
                conditions.push(eq(table[fieldKey], value))
              }
            }
          })
        }

        return conditions.length > 0 ? and(...conditions) : undefined
      },
      orderBy: (table, { asc, desc }) => {
        const orderFn = sortDirection === 'desc' ? desc : asc
        return [orderFn(table[sortField]), orderFn(table.id)]
      },
      limit: limit + 1,
      // Include relations if configured (for secondary info that needs related data)
      ...(displayConfig.withRelations && { with: displayConfig.withRelations }),
    })

    // Generate next cursor
    let nextCursor: string | null = null
    if (items.length > limit) {
      const nextItem = items.pop()!
      const sortValue = nextItem[sortField]
      nextCursor = `${sortValue instanceof Date ? sortValue.toISOString() : sortValue}|${nextItem.id}`
    }

    // Transform to RecordPickerItem
    const transformedItems = items.map((item) => this.transformToPickerItem(tableId, item))

    return {
      items: transformedItems,
      nextCursor,
    }
  }

  /**
   * Fetch resources with join-based organization scoping
   * Example: User table via OrganizationMember
   */
  private async fetchResourcesWithJoin(
    tableId: TableId,
    table: any,
    displayConfig: ResourceDisplayConfig,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, any> | undefined
  ): Promise<PaginatedResourcesResult> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const joinConfig = displayConfig.joinScoping!
    const joinTable = schema[joinConfig.joinTable as keyof typeof schema]

    const conditions: SQL[] = []

    // Organization scoping via join table
    conditions.push(eq(joinTable[joinConfig.joinOrgKey], this.organizationId))

    // Additional conditions from config (e.g., userType = 'USER')
    if (joinConfig.additionalConditions) {
      Object.entries(joinConfig.additionalConditions).forEach(([key, value]) => {
        // Apply condition directly - column existence is guaranteed by config
        conditions.push(eq(table[key], value))
      })
    }

    // Cursor pagination
    const sortField = displayConfig.defaultSortField || 'updatedAt'
    const sortDirection = displayConfig.defaultSortDirection || 'desc'

    if (cursor) {
      const [sortValue, id] = cursor.split('|')
      if (sortValue && id) {
        const comparison = sortDirection === 'desc' ? '<' : '>'
        const eqComparison = sortDirection === 'desc' ? '<' : '>'

        conditions.push(
          or(
            sql`${table[sortField]} ${sql.raw(comparison)} ${sortValue}`,
            and(
              sql`${table[sortField]} = ${sortValue}`,
              sql`${table.id} ${sql.raw(eqComparison)} ${id}`
            )
          )!
        )
      }
    }

    // Search across configured fields
    if (search?.trim()) {
      const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
        ilike(table[fieldKey], `%${search.trim()}%`)
      )
      if (searchConditions.length > 0) {
        conditions.push(or(...searchConditions)!)
      }
    }

    // Apply custom filters
    if (filters) {
      Object.entries(filters).forEach(([fieldKey, value]) => {
        if (value !== undefined && value !== null && table[fieldKey]) {
          if (Array.isArray(value)) {
            conditions.push(inArray(table[fieldKey], value))
          } else {
            conditions.push(eq(table[fieldKey], value))
          }
        }
      })
    }

    // Execute query with join
    const orderByClause =
      sortDirection === 'desc'
        ? [desc(table[sortField]), desc(table.id)]
        : [asc(table[sortField]), asc(table.id)]

    const items = await this.db
      .select()
      .from(joinTable)
      .innerJoin(table, eq(joinTable[joinConfig.joinSourceKey], table[joinConfig.mainTableKey]))
      .where(and(...conditions))
      .orderBy(...orderByClause)
      .limit(limit + 1)

    // Extract main table data from join result
    const tableName = tableConfig.dbName
    const extractedItems = items.map((row: any) => row[tableName])

    // Generate next cursor
    let nextCursor: string | null = null
    if (extractedItems.length > limit) {
      const nextItem = extractedItems.pop()!
      const sortValue = nextItem[sortField]
      nextCursor = `${sortValue instanceof Date ? sortValue.toISOString() : sortValue}|${nextItem.id}`
    }

    // Transform to RecordPickerItem
    const transformedItems = extractedItems.map((item) => this.transformToPickerItem(tableId, item))

    return {
      items: transformedItems,
      nextCursor,
    }
  }

  /**
   * Fetch single resource from database
   */
  private async fetchSingleResourceFromDb(
    tableId: TableId,
    id: string
  ): Promise<RecordPickerItem | null> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
    const tableName = tableConfig.dbName
    const table = schema[tableName as keyof typeof schema]

    const scopingStrategy = displayConfig.orgScopingStrategy || 'direct'

    let item: any = null

    if (scopingStrategy === 'join' && displayConfig.joinScoping) {
      // Fetch with join
      const joinConfig = displayConfig.joinScoping
      const joinTable = schema[joinConfig.joinTable as keyof typeof schema]

      const conditions: SQL[] = [
        eq(table.id, id),
        eq(joinTable[joinConfig.joinOrgKey], this.organizationId),
      ]

      if (joinConfig.additionalConditions) {
        Object.entries(joinConfig.additionalConditions).forEach(([key, value]) => {
          // Apply condition directly - column existence is guaranteed by config
          conditions.push(eq(table[key], value))
        })
      }

      const [result] = await this.db
        .select()
        .from(joinTable)
        .innerJoin(table, eq(joinTable[joinConfig.joinSourceKey], table[joinConfig.mainTableKey]))
        .where(and(...conditions))
        .limit(1)

      item = result ? result[tableName] : null
    } else {
      // Fetch with direct scoping using relational API
      item = await this.db.query[tableName].findFirst({
        where: (table, { eq, and }) => {
          const conditions: SQL[] = [eq(table.id, id)]

          if ('organizationId' in table) {
            conditions.push(eq(table.organizationId, this.organizationId))
          }

          return and(...conditions)
        },
      })
    }

    if (!item) return null

    return this.transformToPickerItem(tableId, item)
  }

  /**
   * Transform database row to RecordPickerItem using display config
   */
  private transformToPickerItem(tableId: TableId, row: any): RecordPickerItem {
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]

    const entityInstanceId = row[displayConfig.identifierField]

    const displayName = row[displayConfig.primaryDisplayFieldId]

    const secondaryInfo = displayConfig.secondaryDisplayFieldId
      ? row[displayConfig.secondaryDisplayFieldId]
      : undefined

    const avatarUrl = displayConfig.avatarFieldId ? row[displayConfig.avatarFieldId] : undefined

    const iconId = displayConfig.iconFieldId
      ? (row[displayConfig.iconFieldId] ?? undefined)
      : undefined

    const color = displayConfig.colorFieldId
      ? (row[displayConfig.colorFieldId] ?? undefined)
      : undefined

    return {
      id: row.id,
      recordId: toRecordId(tableId, entityInstanceId),
      displayName,
      secondaryInfo,
      avatarUrl,
      iconId,
      color,
      data: row,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  /**
   * Fetch paginated EntityInstances for a custom entity type
   */
  private async getEntityInstances(
    resource: CustomResource,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined
  ): Promise<PaginatedResourcesResult> {
    // Build where conditions
    const conditions: SQL[] = [
      eq(schema.EntityInstance.organizationId, this.organizationId),
      eq(schema.EntityInstance.entityDefinitionId, resource.entityDefinitionId),
    ]

    // Cursor pagination
    if (cursor) {
      const [sortValue, id] = cursor.split('|')
      if (sortValue && id) {
        conditions.push(
          or(
            sql`${schema.EntityInstance.updatedAt} < ${sortValue}`,
            and(
              sql`${schema.EntityInstance.updatedAt} = ${sortValue}`,
              sql`${schema.EntityInstance.id} < ${id}`
            )
          )!
        )
      }
    }

    // Query EntityInstances - use pre-computed display columns instead of field values
    const instances = await this.db.query.EntityInstance.findMany({
      where: and(...conditions),
      orderBy: (inst, { desc }) => [desc(inst.updatedAt), desc(inst.id)],
      limit: limit + 1,
    })

    // Generate next cursor
    let nextCursor: string | null = null
    if (instances.length > limit) {
      const nextItem = instances.pop()!
      nextCursor = `${nextItem.updatedAt}|${nextItem.id}`
    }

    // Transform to RecordPickerItems with search filtering
    let transformedItems = instances.map((inst) =>
      this.transformEntityInstanceToPickerItem(resource, inst)
    )

    // Client-side search filtering (TODO: optimize with database search)
    if (search?.trim()) {
      const searchLower = search.trim().toLowerCase()
      transformedItems = transformedItems.filter(
        (item) =>
          item.displayName?.toLowerCase().includes(searchLower) ||
          item.secondaryInfo?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: transformedItems,
      nextCursor,
    }
  }

  /**
   * Fetch single EntityInstance by ID
   */
  private async getEntityInstanceById(
    resource: CustomResource,
    id: string
  ): Promise<RecordPickerItem | null> {
    // Use pre-computed display columns instead of field values
    const instance = await this.db.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, id),
        eq(schema.EntityInstance.organizationId, this.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, resource.entityDefinitionId)
      ),
    })

    if (!instance) return null

    return this.transformEntityInstanceToPickerItem(resource, instance)
  }

  /**
   * Transform an EntityInstance to RecordPickerItem using pre-computed display columns.
   * EntityInstance.displayName, secondaryDisplayValue, and avatarUrl are populated
   * by FieldValueService.maybeUpdateDisplayValue() when field values are set.
   */
  private transformEntityInstanceToPickerItem(
    resource: CustomResource,
    instance: {
      id: string
      displayName: string | null
      secondaryDisplayValue: string | null
      avatarUrl: string | null
      createdAt: string
      updatedAt: string
    }
  ): RecordPickerItem {
    const { displayName, secondaryInfo } = resolveEntityDisplay(
      instance.displayName,
      instance.secondaryDisplayValue,
      instance.id
    )
    return {
      id: instance.id,
      recordId: toRecordId(resource.id, instance.id),
      displayName,
      secondaryInfo,
      avatarUrl: instance.avatarUrl || undefined,
      data: instance,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }
  }

  /**
   * Get multiple resources by IDs (batch)
   * Works with both system resources (TableId) and custom entities (UUID-based)
   *
   * @param recordIds - Array of RecordId (format: entityDefinitionId:entityInstanceId)
   * @returns Record keyed by RecordId
   */
  async getResourcesByIds(recordIds: RecordId[]): Promise<Record<RecordId, RecordPickerItem>> {
    const result: Record<RecordId, RecordPickerItem> = {}

    // Group by entityDefinitionId for efficient batching
    const grouped = new Map<string, string[]>()
    for (const recordId of recordIds) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      if (!grouped.has(entityDefinitionId)) grouped.set(entityDefinitionId, [])
      grouped.get(entityDefinitionId)!.push(entityInstanceId)
    }

    // Read enforcement (plan v3/03 §5.1/§5.2): drop groups the member cannot
    // reach AT ALL (arm 4 — no def view and no grants), and remember the scope
    // for the ones that survive so the per-row predicate + `_access` stamp ride
    // the fetch below. Unauthorized ids DROP SILENTLY from the batch — the
    // caller's map simply has no entry — matching `getById`'s non-enumeration.
    const scopes = new Map<string, RecordVisibilityScope>()
    if (this.capabilities) {
      for (const defId of [...grouped.keys()]) {
        const scope = await this.recordScope(defId)
        if (scope.arm === 'none') {
          grouped.delete(defId)
          continue
        }
        scopes.set(defId, scope)
      }
    }

    // Resolve entity definition type strings (e.g. 'ticket', 'contact') to UUIDs
    const resolvedGrouped = new Map<string, { ids: string[]; originalKey: string }>()
    for (const [entityDefinitionId, ids] of grouped) {
      if (isEntityDefinitionType(entityDefinitionId)) {
        // Resolve type name to actual EntityDefinition UUID via cache
        const resolvedId = await getCachedEntityDefId(this.organizationId, entityDefinitionId)
        if (resolvedId) {
          resolvedGrouped.set(resolvedId, { ids, originalKey: entityDefinitionId })
        }
      } else {
        resolvedGrouped.set(entityDefinitionId, { ids, originalKey: entityDefinitionId })
      }
    }

    // Fetch each group in parallel
    await Promise.all(
      Array.from(resolvedGrouped.entries()).map(async ([resolvedId, { ids, originalKey }]) => {
        if (isCustomResourceId(resolvedId)) {
          // Custom entity - fetch EntityInstances by IDs
          const resource = await getCachedResource(this.organizationId, resolvedId)
          if (!resource) {
            // Reverse-lookup: a UUID prefix that doesn't resolve through the
            // resource cache may still belong to a system-table-backed
            // EntityDefinition (e.g. article — its EntityDefinition row is
            // filtered out of the resource cache because the data lives in a
            // dedicated table). Check the entityDefs cache for an entityType
            // that matches a TableId in RESOURCE_TABLE_MAP.
            const tableId = await this.reverseEntityDefToTableId(resolvedId)
            if (tableId) {
              const { items: fetched } = await this.fetchResourcesFromDb(
                tableId,
                ids.length,
                null,
                undefined,
                { id: ids }
              )
              for (const item of fetched) {
                // Re-key to caller's UUID prefix so the result map lookup matches.
                const key = toRecordId(originalKey, item.id) as RecordId
                result[key] = { ...item, recordId: key }
              }
              return
            }
            logger.warn('Resource not found in cache for getResourcesByIds', {
              organizationId: this.organizationId,
              resolvedId,
              requestedIds: ids,
            })
            return
          }
          const fetched = await this.fetchEntityInstancesByIds(resource, ids, originalKey)
          if (fetched.length < ids.length) {
            const fetchedIds = new Set(fetched.map((f) => f.id))
            const missingIds = ids.filter((id) => !fetchedIds.has(id))
            logger.warn('Some entity instances not found by getResourcesByIds', {
              organizationId: this.organizationId,
              entityDefinitionId: resource.entityDefinitionId,
              requestedIds: ids,
              missingIds,
            })
          }
          for (const item of fetched) {
            // Re-key with original entityDefinitionId to match the caller's RecordId format
            const key = toRecordId(originalKey, item.id) as RecordId
            result[key] = { ...item, recordId: key }
          }
        } else if (RESOURCE_TABLE_MAP[resolvedId as TableId]) {
          // System resource - use existing fetchResourcesFromDb with ID filter
          const { items: fetched } = await this.fetchResourcesFromDb(
            resolvedId as TableId,
            ids.length,
            null,
            undefined,
            { id: ids }
          )
          for (const item of fetched) result[item.recordId] = item
        }
      })
    )

    await this.attachRecordSources(result)
    return result
  }

  /**
   * Attach app-origin identity chips (`sources[]`) to a batch of picker items
   * from the `RecordIdentity` index — the record-grain source badge, replacing
   * the retired `EntityInstance.integrationSource`. App-less links (chat,
   * social) carry no `appInstallationId` and are skipped here (they surface in
   * the External identities card). Deduped by app + connection.
   */
  private async attachRecordSources(items: Record<RecordId, RecordPickerItem>): Promise<void> {
    const recordKeys = Object.keys(items) as RecordId[]
    if (recordKeys.length === 0) return

    const identities = await getRecordIdentitiesForRecords(this.organizationId, recordKeys, this.db)
    for (const [recordId, rows] of identities) {
      const item = items[recordId]
      if (!item) continue
      const seen = new Set<string>()
      const sources: RecordSourceChip[] = []
      for (const row of rows) {
        if (!row.appInstallationId) continue
        const dedupeKey = `${row.appInstallationId}:${row.connectionId ?? ''}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        sources.push({
          source: row.source,
          appInstallationId: row.appInstallationId,
          connectionId: row.connectionId,
        })
      }
      if (sources.length > 0) item.sources = sources
    }
  }

  /**
   * Reverse-resolve an EntityDefinition UUID to a system TableId via the
   * entityDefs org cache. Returns undefined if no entityType matches a known
   * TableId (i.e. the UUID belongs to a custom EntityInstance-backed entity).
   */
  private async reverseEntityDefToTableId(
    entityDefinitionId: string
  ): Promise<TableId | undefined> {
    const entityDefs = await getOrgCache().get(this.organizationId, 'entityDefs')
    const entityType = Object.entries(entityDefs).find(
      ([, defId]) => defId === entityDefinitionId
    )?.[0]
    if (!entityType) return undefined
    return RESOURCE_TABLE_MAP[entityType as TableId] ? (entityType as TableId) : undefined
  }

  /**
   * Fetch entity instances by IDs
   * Uses pre-computed display columns instead of field values
   */
  private async fetchEntityInstancesByIds(
    resource: CustomResource,
    ids: string[],
    /** The caller's def key — the keyspace `_access` and the scope are resolved in. */
    defKey?: string
  ): Promise<RecordPickerItem[]> {
    // Plan v3/03 §5.1 + §5.2 in ONE query: the visibility predicate narrows the
    // batch (unauthorized ids simply do not come back), and the grantee-union
    // `max(rung)` aggregate rides the same projection as the row so the picker
    // item carries its own row-effective level with no second roundtrip.
    const caps = this.capabilities
    const scopeKey = defKey ?? resource.entityDefinitionId
    const scope = caps ? await this.recordScope(scopeKey) : { arm: 'all' as const }
    if (scope.arm === 'none') return []

    const rank = caps ? await this.recordAccessRank(scopeKey) : null
    const rows = await this.db
      .select({
        instance: schema.EntityInstance,
        ...(rank ? { grantRank: rank } : {}),
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, this.organizationId),
          eq(schema.EntityInstance.entityDefinitionId, resource.entityDefinitionId),
          inArray(schema.EntityInstance.id, ids),
          scope.where
        )
      )

    return rows.map((row) => {
      const item = this.transformEntityInstanceToPickerItem(resource, row.instance)
      if (!caps) return item
      const grantRank = (row as { grantRank?: number | null }).grantRank ?? null
      return { ...item, _access: caps.recordAccessAt(scopeKey, grantRank) }
    })
  }

  /**
   * The §5.1 per-record visibility scope for one def, memoized per service.
   * Mirrors `UnifiedCrudHandler.recordScope` — the picker is a second entry
   * point into the same read lane, not a second policy.
   */
  private async recordScope(entityDefinitionId: string): Promise<RecordVisibilityScope> {
    // No member ⇒ no grantee union to resolve ⇒ internal caller semantics, the
    // same answer `capabilities: undefined` gets.
    if (!this.userId) return { arm: 'all' }
    if (RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) return { arm: 'all' }
    // Arms 1 and 4 are decided in memory, before any def normalization or
    // grantee resolution — see `UnifiedCrudHandler.recordScope` for why.
    const arm = recordScopeArmFor(this.capabilities, entityDefinitionId)
    if (arm === 'all' || arm === 'none') return { arm }
    const defId = await this.canonicalDefId(entityDefinitionId)
    const cached = this.scopeCache.get(defId)
    if (cached) return cached
    const pending = resolveRecordVisibilityScope({
      organizationId: this.organizationId,
      userId: this.userId,
      entityDefinitionId: defId,
      capabilities: this.capabilities,
    })
    this.scopeCache.set(defId, pending)
    return pending
  }

  /** The grantee-union `max(rung)` subquery for one def — the `_access` grant half. */
  private async recordAccessRank(entityDefinitionId: string): Promise<SQL<number | null> | null> {
    if (!this.userId) return null
    const defId = await this.canonicalDefId(entityDefinitionId)
    const grantees = await resolveResourceAccessGrantees(this.organizationId, this.userId)
    return recordAccessRankSql({
      organizationId: this.organizationId,
      entityDefinitionId: defId,
      grantees,
    })
  }

  /** Any def form → the canonical `EntityDefinition.id` (the ResourceAccess keyspace). */
  private async canonicalDefId(entityDefinitionId: string): Promise<string> {
    const resource = await getCachedResource(this.organizationId, entityDefinitionId)
    return resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId
  }

  /**
   * Invalidate cache for entity definition
   */
  async invalidateCacheByTable(entityDefinitionId: string): Promise<void> {
    await this.cache.invalidateByTable(entityDefinitionId)
  }

  /**
   * Invalidate cache for specific item
   */
  async invalidateCacheById(entityDefinitionId: string, id: string): Promise<void> {
    await this.cache.invalidateById(entityDefinitionId, id)
  }

  /**
   * Search EntityInstances using PostgreSQL full-text search with GIN indexes.
   * Supports both scoped search (specific entityDefinitionId) and global search (all EntityInstances).
   *
   * Uses:
   * - Full-text search with ts_rank_cd on searchText column
   * - Trigram similarity on displayName for fuzzy matching
   * - ILIKE fallback for short queries or edge cases
   * - If query is empty, returns first N records ordered by updatedAt
   *
   * @param params - Search parameters
   * @returns Paginated search results with metadata
   */
  /** An empty {@link GlobalSearchResult} (read enforcement denials, §2.2). */
  private emptySearchResult(query: string, startTime: number): GlobalSearchResult {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      processingTimeMs: performance.now() - startTime,
      query,
    }
  }

  async search(params: GlobalSearchParams): Promise<GlobalSearchResult> {
    const startTime = performance.now()
    const { query = '', entityDefinitionId, limit = 25, cursor } = params
    let { entityDefinitionIds } = params

    const trimmedQuery = query.trim()

    // Read enforcement (plan v3/03 §5.1) — all three live arms:
    //  - Scoped single def → the def's own scope; arm 4 returns empty with no
    //    query, arms 2/3 contribute `scopedVisibility` to the WHERE below.
    //  - Multi-def list → keep every def the member has PRESENCE on (viewable
    //    OR grant-only), then narrow the grant-only half per row.
    //  - Global union (no scope) → enforces itself inside `searchGlobalUnion`:
    //    the grant-only arm is pushed into the EntityInstance leg in SQL, and the
    //    system-table legs keep a `canViewEntity` post-filter widened to admit
    //    grant-only defs. Grant-only defs are NO LONGER excluded there.
    let scopedVisibility: SQL | undefined
    let listVisibility: SQL | undefined
    if (this.capabilities) {
      if (entityDefinitionId) {
        // Built against the `ei` alias this query uses — the scope module takes
        // the correlation column, so there is still exactly one predicate shape.
        const scope = await resolveRecordVisibilityScope({
          organizationId: this.organizationId,
          userId: this.userId ?? '',
          entityDefinitionId: await this.canonicalDefId(entityDefinitionId),
          capabilities: this.capabilities,
          instanceIdColumn: sql.raw('ei."id"'),
        })
        if (scope.arm === 'none') return this.emptySearchResult(trimmedQuery, startTime)
        scopedVisibility = scope.where
      }
      if (entityDefinitionIds && entityDefinitionIds.length > 0) {
        const viewable: string[] = []
        const grantOnly: string[] = []
        for (const defId of entityDefinitionIds) {
          if (this.capabilities.canViewEntity(defId)) viewable.push(defId)
          else if (this.capabilities.hasRecordGrantsOn(defId)) grantOnly.push(defId)
        }
        entityDefinitionIds = [...viewable, ...grantOnly]
        if (entityDefinitionIds.length === 0) {
          return this.emptySearchResult(trimmedQuery, startTime)
        }
        const predicate = recordSearchVisibilitySql({
          organizationId: this.organizationId,
          grantees: await resolveResourceAccessGrantees(this.organizationId, this.userId ?? ''),
          fullyViewableDefIds: viewable,
          grantOnlyDefIds: grantOnly,
          instanceIdColumn: sql.raw('ei."id"'),
          defIdColumn: sql.raw('ei."entityDefinitionId"'),
        })
        if (predicate === null) return this.emptySearchResult(trimmedQuery, startTime)
        listVisibility = predicate
      }
    }
    const visibilityFilter = scopedVisibility
      ? sql`AND ${scopedVisibility}`
      : listVisibility
        ? sql`AND ${listVisibility}`
        : sql``

    // Global union mode: no scope passed → union system tables + EntityInstance.
    // Unpaginated in v1; each kind contributes up to perKindCap items merge-sorted
    // by updatedAt desc.
    if (!entityDefinitionId && (!entityDefinitionIds || entityDefinitionIds.length === 0)) {
      // The UNSCOPED union — its own visibility lives inside `searchGlobalUnion`
      // (§5.1's grant-only arm pushed into the EntityInstance leg, plus the
      // `canViewEntity` post-filter the system-table legs still need).
      return this.searchGlobalUnion(trimmedQuery, limit, startTime)
    }

    // Build entity definition filter
    let entityDefFilter = sql``
    if (entityDefinitionId) {
      // Scoped search - single entity definition
      entityDefFilter = sql`AND ei."entityDefinitionId" = ${entityDefinitionId}`
    } else if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      // Filter to multiple entity definitions
      const idsArray = `{${entityDefinitionIds.join(',')}}`
      entityDefFilter = sql`AND ei."entityDefinitionId" = ANY(${idsArray}::text[])`
    }
    // If neither provided, search all EntityInstances (no filter)

    // If no query, return first N records ordered by updatedAt
    if (!trimmedQuery) {
      return this.getRecentEntityInstances({
        entityDefinitionId,
        entityDefinitionIds,
        limit,
        cursor,
        visibilityFilter,
      })
    }

    // Decode cursor if provided (for search results, cursor is score|id)
    let cursorScore = 0
    let cursorId = ''
    if (cursor) {
      const [score, id] = cursor.split('|')
      cursorScore = parseFloat(score || '0')
      cursorId = id || ''
    }

    // Build cursor pagination filter for search results
    let cursorFilter = sql``
    if (cursor && cursorId) {
      cursorFilter = sql`AND (
        (COALESCE(similarity(ei."displayName", ${trimmedQuery}), 0) * 2 + COALESCE(ts_rank_cd(
          to_tsvector('english', COALESCE(ei."searchText", '')),
          plainto_tsquery('english', ${trimmedQuery})
        ), 0)) < ${cursorScore}
        OR (
          (COALESCE(similarity(ei."displayName", ${trimmedQuery}), 0) * 2 + COALESCE(ts_rank_cd(
            to_tsvector('english', COALESCE(ei."searchText", '')),
            plainto_tsquery('english', ${trimmedQuery})
          ), 0)) = ${cursorScore}
          AND ei.id < ${cursorId}
        )
      )`
    }

    // Execute full-text search with GIN indexes
    const searchResults = (
      await this.db.execute(sql`
        SELECT
          ei.id,
          ei."entityDefinitionId",
          ei."displayName",
          ei."secondaryDisplayValue",
          ei."avatarUrl",
          ei."searchText",
          ei."createdAt",
          ei."updatedAt",
          ed."singular" as "entityType",
          ed."icon" as "entityIcon",
          ed."color" as "entityColor",
          -- Full-text search score on searchText
          ts_rank_cd(
            to_tsvector('english', COALESCE(ei."searchText", '')),
            plainto_tsquery('english', ${trimmedQuery})
          ) as text_score,
          -- Trigram similarity on displayName (for typo tolerance)
          similarity(ei."displayName", ${trimmedQuery}) as name_score,
          -- Combined score for ranking
          (COALESCE(similarity(ei."displayName", ${trimmedQuery}), 0) * 2 + COALESCE(ts_rank_cd(
            to_tsvector('english', COALESCE(ei."searchText", '')),
            plainto_tsquery('english', ${trimmedQuery})
          ), 0)) as combined_score
        FROM "EntityInstance" ei
        JOIN "EntityDefinition" ed ON ei."entityDefinitionId" = ed.id
        WHERE
          ei."organizationId" = ${this.organizationId}
          AND ei."archivedAt" IS NULL
          AND (
            -- Full-text match on searchText
            to_tsvector('english', COALESCE(ei."searchText", '')) @@ plainto_tsquery('english', ${trimmedQuery})
            -- OR trigram match on displayName (fuzzy)
            OR similarity(ei."displayName", ${trimmedQuery}) > 0.3
            -- OR ILIKE fallback for short queries
            OR ei."displayName" ILIKE ${`%${trimmedQuery}%`}
            OR ei."secondaryDisplayValue" ILIKE ${`%${trimmedQuery}%`}
          )
          ${entityDefFilter}
          ${visibilityFilter}
          ${cursorFilter}
        ORDER BY
          -- Combine scores: prefer exact displayName matches, then text relevance
          combined_score DESC,
          ei."updatedAt" DESC,
          ei.id DESC
        LIMIT ${limit + 1}
      `)
    ).rows as Array<{
      id: string
      entityDefinitionId: string
      displayName: string | null
      secondaryDisplayValue: string | null
      avatarUrl: string | null
      searchText: string | null
      createdAt: string
      updatedAt: string
      entityType: string
      entityIcon: string | null
      entityColor: string | null
      text_score: number
      name_score: number
      combined_score: number
    }>

    // Generate next cursor
    let nextCursor: string | null = null
    if (searchResults.length > limit) {
      const lastItem = searchResults.pop()!
      nextCursor = `${lastItem.combined_score}|${lastItem.id}`
    }

    // Transform to RecordPickerItem format
    const items: RecordPickerItem[] = searchResults.map((row) => {
      const { displayName, secondaryInfo } = resolveEntityDisplay(
        row.displayName,
        row.secondaryDisplayValue,
        row.id
      )
      return {
        id: row.id,
        recordId: toRecordId(row.entityDefinitionId, row.id),
        displayName,
        secondaryInfo,
        avatarUrl: row.avatarUrl || undefined,
        data: {
          ...row,
          entityType: row.entityType,
          entityIcon: row.entityIcon,
          entityColor: row.entityColor,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })

    const processingTimeMs = performance.now() - startTime

    logger.debug('Global search completed', {
      query: trimmedQuery,
      entityDefinitionId,
      entityDefinitionIds,
      organizationId: this.organizationId,
      resultsCount: items.length,
      hasMore: nextCursor !== null,
      processingTimeMs,
    })

    return {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
      processingTimeMs,
      query: trimmedQuery,
    }
  }

  /**
   * Get recent EntityInstances when no search query is provided.
   * Returns records ordered by updatedAt DESC.
   */
  private async getRecentEntityInstances(params: {
    entityDefinitionId?: string
    entityDefinitionIds?: string[]
    limit: number
    cursor?: string
    /**
     * The §5.1 per-record predicate, already built against the `ei` alias by
     * {@link search}. Threaded rather than rebuilt so the empty-query arm and
     * the full-text arm are narrowed by the SAME predicate — a query box that
     * reveals rows when you clear it is the classic shape of this bug.
     */
    visibilityFilter?: SQL
  }): Promise<GlobalSearchResult> {
    const startTime = performance.now()
    const { entityDefinitionId, entityDefinitionIds, limit, cursor } = params

    // Build entity definition filter
    let entityDefFilter = sql``
    if (entityDefinitionId) {
      entityDefFilter = sql`AND ei."entityDefinitionId" = ${entityDefinitionId}`
    } else if (entityDefinitionIds && entityDefinitionIds.length > 0) {
      const idsArray = `{${entityDefinitionIds.join(',')}}`
      entityDefFilter = sql`AND ei."entityDefinitionId" = ANY(${idsArray}::text[])`
    }

    // Decode cursor (for recent results, cursor is updatedAt|id)
    let cursorFilter = sql``
    if (cursor) {
      const [updatedAt, id] = cursor.split('|')
      if (updatedAt && id) {
        cursorFilter = sql`AND (
          ei."updatedAt" < ${updatedAt}::timestamp
          OR (ei."updatedAt" = ${updatedAt}::timestamp AND ei.id < ${id})
        )`
      }
    }

    const results = (
      await this.db.execute(sql`
        SELECT
          ei.id,
          ei."entityDefinitionId",
          ei."displayName",
          ei."secondaryDisplayValue",
          ei."avatarUrl",
          ei."createdAt",
          ei."updatedAt",
          ed."singular" as "entityType",
          ed."icon" as "entityIcon",
          ed."color" as "entityColor"
        FROM "EntityInstance" ei
        JOIN "EntityDefinition" ed ON ei."entityDefinitionId" = ed.id
        WHERE
          ei."organizationId" = ${this.organizationId}
          AND ei."archivedAt" IS NULL
          ${entityDefFilter}
          ${params.visibilityFilter ?? sql``}
          ${cursorFilter}
        ORDER BY ei."updatedAt" DESC, ei.id DESC
        LIMIT ${limit + 1}
      `)
    ).rows as Array<{
      id: string
      entityDefinitionId: string
      displayName: string | null
      secondaryDisplayValue: string | null
      avatarUrl: string | null
      createdAt: string
      updatedAt: string
      entityType: string
      entityIcon: string | null
      entityColor: string | null
    }>

    // Generate next cursor
    let nextCursor: string | null = null
    if (results.length > limit) {
      const lastItem = results.pop()!
      nextCursor = `${lastItem.updatedAt}|${lastItem.id}`
    }

    // Transform to RecordPickerItem format
    const items: RecordPickerItem[] = results.map((row) => {
      const { displayName, secondaryInfo } = resolveEntityDisplay(
        row.displayName,
        row.secondaryDisplayValue,
        row.id
      )
      return {
        id: row.id,
        recordId: toRecordId(row.entityDefinitionId, row.id),
        displayName,
        secondaryInfo,
        avatarUrl: row.avatarUrl || undefined,
        data: {
          ...row,
          entityType: row.entityType,
          entityIcon: row.entityIcon,
          entityColor: row.entityColor,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })

    const processingTimeMs = performance.now() - startTime

    logger.debug('Recent entities fetched', {
      entityDefinitionId,
      entityDefinitionIds,
      organizationId: this.organizationId,
      resultsCount: items.length,
      hasMore: nextCursor !== null,
      processingTimeMs,
    })

    return {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
      processingTimeMs,
      query: '',
    }
  }

  /**
   * The record defs this member reaches **only** through per-record grants —
   * `hasDefPresence(def) && !canViewEntity(def)`, resolved against the org's def
   * catalog and therefore bounded by DEF COUNT, never by grant count. No grant-id
   * set is materialized here or anywhere else; the per-ROW answer stays in SQL.
   *
   * The two exclusions are the record-lane test spelled out in
   * `computeGrantedDefIds`, restated at the site where getting it wrong would be
   * worst. `hasRecordGrantsOn` already reads a `grantedDefIds` map the composer
   * built with the same two exclusions applied, so this is belt-and-braces — but
   * this arm merges the MAIL system tables into its result, and a `contact` grant
   * canonicalizes into the mail keyspace and fans a full lens across that
   * contact's entire conversation history (§10.1). `isInstanceAccessKey` alone is
   * NOT the test: it is blob-lane only, so it answers `false` for `thread`.
   *
   * Empty (and free) for the overwhelmingly common member who holds no per-record
   * grant at all.
   */
  private async grantOnlyRecordDefIds(): Promise<string[]> {
    const capabilities = this.capabilities
    if (!capabilities) return []
    const resources = await getCachedResources(this.organizationId)
    const grantOnly: string[] = []
    for (const resource of resources) {
      const defId = resource.entityDefinitionId ?? resource.id
      const laneKey = resource.entityType ?? defId
      if (isDeclaredInstanceDomain(laneKey) || isMailSharingDef(laneKey)) continue
      if (capabilities.canViewEntity(defId)) continue
      if (!capabilities.hasRecordGrantsOn(defId)) continue
      grantOnly.push(defId)
    }
    return grantOnly
  }

  /**
   * Global union search across system tables + EntityInstance.
   * Each kind contributes up to perKindCap items (capped at limit overall).
   * Merge-sorted by updatedAt desc. Unpaginated in v1.
   *
   * **Read enforcement lives here, not in the caller** (plan v3/03 §5.1, the
   * UNSCOPED arm). Two halves, because the union has two kinds of leg:
   *
   *  - The **EntityInstance** leg is narrowed IN SQL by
   *    {@link recordUnionVisibilitySql} — rows of a grant-only def survive only
   *    with a `read`-or-better grant addressed to this member. Applied before the
   *    per-kind cap, so a grant-only row competes for the bucket on equal terms
   *    instead of being fetched and then discarded.
   *  - The **system-table** legs (thread, user, …) are not `EntityInstance` rows
   *    and carry no record grants, so they keep the `canViewEntity` post-filter
   *    they have always had.
   *
   * The post-filter is widened to `canViewEntity(def) || <grant-only def>` for the
   * same reason: `canViewEntity` is `false` for a grant-only def by construction,
   * so leaving it as the sole test would discard exactly the rows the SQL just
   * authorized. It now runs BEFORE the final slice rather than in the caller after
   * it, so a page is no longer shortened by rows the member could never see.
   */
  private async searchGlobalUnion(
    trimmedQuery: string,
    limit: number,
    startTime: number
  ): Promise<GlobalSearchResult> {
    const tableIds = Object.keys(RESOURCE_TABLE_MAP) as TableId[]
    const kindCount = tableIds.length + 1 // +1 for EntityInstance bucket
    const perKindCap = Math.max(1, Math.ceil(limit / kindCount))

    const grantOnlyDefIds = await this.grantOnlyRecordDefIds()
    const grantOnlyDefSet = new Set(grantOnlyDefIds)
    const eiVisibility =
      grantOnlyDefIds.length > 0
        ? recordUnionVisibilitySql({
            organizationId: this.organizationId,
            grantees: await resolveResourceAccessGrantees(this.organizationId, this.userId ?? ''),
            grantOnlyDefIds,
            instanceIdColumn: sql.raw('ei."id"'),
            defIdColumn: sql.raw('ei."entityDefinitionId"'),
          })
        : undefined

    // System tables: use their existing direct-fetch path (respects display config).
    const systemPromises = tableIds.map(async (tableId) => {
      try {
        const result = await this.fetchResourcesFromDb(
          tableId,
          perKindCap,
          null,
          trimmedQuery || undefined,
          undefined
        )
        return result.items
      } catch (err) {
        logger.warn('searchGlobalUnion: per-kind fetch failed', {
          tableId,
          error: (err as Error).message,
        })
        return [] as RecordPickerItem[]
      }
    })

    // EntityInstance bucket via existing scoped search path (recursive call,
    // but with entityDefinitionIds=[] still ambiguous; pass an empty list of
    // ed IDs via the underlying SQL path by stripping the union guard).
    const eiPromise = (async (): Promise<RecordPickerItem[]> => {
      try {
        const eiResult = await this.searchEntityInstancesOnly(
          trimmedQuery,
          perKindCap,
          eiVisibility
        )
        return eiResult
      } catch (err) {
        logger.warn('searchGlobalUnion: EntityInstance fetch failed', {
          error: (err as Error).message,
        })
        return []
      }
    })()

    const buckets = await Promise.all([...systemPromises, eiPromise])
    const merged = buckets.flat()

    // Sort by updatedAt desc, fall back to createdAt, then id.
    merged.sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.createdAt).getTime()
      const bTime = new Date(b.updatedAt ?? b.createdAt).getTime()
      if (bTime !== aTime) return bTime - aTime
      return b.id.localeCompare(a.id)
    })

    const capabilities = this.capabilities
    const visible = capabilities
      ? merged.filter((item) => {
          const defId = parseRecordId(item.recordId).entityDefinitionId
          return capabilities.canViewEntity(defId) || grantOnlyDefSet.has(defId)
        })
      : merged

    const items = visible.slice(0, limit)
    const processingTimeMs = performance.now() - startTime

    logger.debug('Global union search completed', {
      query: trimmedQuery,
      organizationId: this.organizationId,
      kindCount,
      perKindCap,
      resultsCount: items.length,
      processingTimeMs,
    })

    return {
      items,
      nextCursor: null,
      hasMore: false,
      processingTimeMs,
      query: trimmedQuery,
    }
  }

  /**
   * EntityInstance-only search slice. Mirrors `search()` but unconditionally
   * scopes to EntityInstance, used by `searchGlobalUnion` for the EntityInstance
   * bucket without re-entering the union branch.
   *
   * `visibilityFilter` is the union arm's §5.1 predicate, already built against
   * the `ei` alias by {@link searchGlobalUnion}. Applied to BOTH the empty-query
   * and the full-text query — a search box that reveals rows when you clear it is
   * the classic shape of this bug, and `getRecentEntityInstances` carries the
   * same note for the same reason.
   */
  private async searchEntityInstancesOnly(
    trimmedQuery: string,
    limit: number,
    visibilityFilter?: SQL
  ): Promise<RecordPickerItem[]> {
    const visibility = visibilityFilter ? sql`AND ${visibilityFilter}` : sql``
    if (!trimmedQuery) {
      const recent = (
        await this.db.execute(sql`
          SELECT
            ei.id,
            ei."entityDefinitionId",
            ei."displayName",
            ei."secondaryDisplayValue",
            ei."avatarUrl",
            ei."createdAt",
            ei."updatedAt"
          FROM "EntityInstance" ei
          WHERE ei."organizationId" = ${this.organizationId}
            AND ei."archivedAt" IS NULL
            ${visibility}
          ORDER BY ei."updatedAt" DESC, ei.id DESC
          LIMIT ${limit}
        `)
      ).rows as Array<{
        id: string
        entityDefinitionId: string
        displayName: string | null
        secondaryDisplayValue: string | null
        avatarUrl: string | null
        createdAt: string
        updatedAt: string
      }>
      return recent.map((row) => {
        const { displayName, secondaryInfo } = resolveEntityDisplay(
          row.displayName,
          row.secondaryDisplayValue,
          row.id
        )
        return {
          id: row.id,
          recordId: toRecordId(row.entityDefinitionId, row.id),
          displayName,
          secondaryInfo,
          avatarUrl: row.avatarUrl || undefined,
          data: row,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      })
    }

    const results = (
      await this.db.execute(sql`
        SELECT
          ei.id,
          ei."entityDefinitionId",
          ei."displayName",
          ei."secondaryDisplayValue",
          ei."avatarUrl",
          ei."createdAt",
          ei."updatedAt"
        FROM "EntityInstance" ei
        WHERE ei."organizationId" = ${this.organizationId}
          AND ei."archivedAt" IS NULL
          AND (
            to_tsvector('english', COALESCE(ei."searchText", '')) @@ plainto_tsquery('english', ${trimmedQuery})
            OR similarity(ei."displayName", ${trimmedQuery}) > 0.3
            OR ei."displayName" ILIKE ${`%${trimmedQuery}%`}
            OR ei."secondaryDisplayValue" ILIKE ${`%${trimmedQuery}%`}
          )
          ${visibility}
        ORDER BY ei."updatedAt" DESC, ei.id DESC
        LIMIT ${limit}
      `)
    ).rows as Array<{
      id: string
      entityDefinitionId: string
      displayName: string | null
      secondaryDisplayValue: string | null
      avatarUrl: string | null
      createdAt: string
      updatedAt: string
    }>
    return results.map((row) => {
      const { displayName, secondaryInfo } = resolveEntityDisplay(
        row.displayName,
        row.secondaryDisplayValue,
        row.id
      )
      return {
        id: row.id,
        recordId: toRecordId(row.entityDefinitionId, row.id),
        displayName,
        secondaryInfo,
        avatarUrl: row.avatarUrl || undefined,
        data: row,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })
  }
}
