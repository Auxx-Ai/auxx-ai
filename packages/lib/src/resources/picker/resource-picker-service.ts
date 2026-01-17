// packages/lib/src/workflow-engine/resources/picker/resource-picker-service.ts

import { type Database, schema } from '@auxx/database'
import { eq, and, desc, asc, or, ilike, sql, inArray, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import {
  RESOURCE_TABLE_MAP,
  RESOURCE_DISPLAY_CONFIG,
  ResourceRegistryService,
  isCustomResource,
  type TableId,
  type ResourceDisplayConfig,
  type CustomResource,
} from '../registry'
import { ResourcePickerCacheService } from './resource-picker-cache'
import type {
  GetResourcesInput,
  ResourcePickerItem,
  PaginatedResourcesResult,
  GetResourceByIdInput,
  GlobalSearchParams,
  GlobalSearchResult,
} from './types'
import type { ResourceId } from '@auxx/types/resource'
import { parseResourceId, toResourceId } from '../resource-id'

const logger = createScopedLogger('resource-picker-service')

/**
 * Generic resource picker service
 * Works with any table defined in RESOURCE_TABLE_REGISTRY
 * Handles both direct and join-based organization scoping
 */
export class ResourcePickerService {
  private db: Database
  private organizationId: string
  private userId?: string
  private cache: ResourcePickerCacheService
  private registryService: ResourceRegistryService

  constructor(organizationId: string, userId: string | undefined, db: Database) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
    this.cache = new ResourcePickerCacheService()
    this.registryService = new ResourceRegistryService(organizationId, db)
  }

  /**
   * Get paginated resources for picker
   * Supports both system resources (TableId) and custom entities (UUID-based)
   */
  async getResources(input: GetResourcesInput): Promise<PaginatedResourcesResult> {
    const { entityDefinitionId, limit, cursor, search, filters, skipCache } = input

    // Check if it's a custom entity (UUID-based entityDefinitionId)
    if (this.registryService.isCustomResource(entityDefinitionId)) {
      const resource = await this.registryService.getById(entityDefinitionId)
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
  async getResourceById(input: GetResourceByIdInput): Promise<ResourcePickerItem | null> {
    const { entityDefinitionId, id } = input

    // Check if it's a custom entity (UUID-based entityDefinitionId)
    if (this.registryService.isCustomResource(entityDefinitionId)) {
      const resource = await this.registryService.getById(entityDefinitionId)
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
        if (search && search.trim()) {
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

    // Transform to ResourcePickerItem
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
    if (search && search.trim()) {
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

    // Transform to ResourcePickerItem
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
  ): Promise<ResourcePickerItem | null> {
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
   * Transform database row to ResourcePickerItem using display config
   */
  private transformToPickerItem(tableId: TableId, row: any): ResourcePickerItem {
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]

    const entityInstanceId = row[displayConfig.identifierField]

    const displayName = row[displayConfig.primaryDisplayFieldId]

    const secondaryInfo = displayConfig.secondaryDisplayFieldId
      ? row[displayConfig.secondaryDisplayFieldId]
      : undefined

    const avatarUrl = displayConfig.avatarFieldId ? row[displayConfig.avatarFieldId] : undefined

    return {
      id: row.id,
      resourceId: toResourceId(tableId, entityInstanceId),
      displayName,
      secondaryInfo,
      avatarUrl,
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

    // Transform to ResourcePickerItems with search filtering
    let transformedItems = instances.map((inst) =>
      this.transformEntityInstanceToPickerItem(resource, inst)
    )

    // Client-side search filtering (TODO: optimize with database search)
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase()
      transformedItems = transformedItems.filter(
        (item) =>
          item.displayName?.toLowerCase().includes(searchLower) ||
          item.secondaryInfo?.toLowerCase().includes(searchLower) ||
          item.entityInstanceId?.toLowerCase().includes(searchLower)
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
  ): Promise<ResourcePickerItem | null> {
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
   * Transform an EntityInstance to ResourcePickerItem using pre-computed display columns.
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
  ): ResourcePickerItem {
    return {
      id: instance.id,
      resourceId: toResourceId(resource.id, instance.id),
      displayName: instance.displayName || instance.id,
      secondaryInfo: instance.secondaryDisplayValue || undefined,
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
   * @param resourceIds - Array of ResourceId (format: entityDefinitionId:entityInstanceId)
   * @returns Record keyed by ResourceId
   */
  async getResourcesByIds(
    resourceIds: ResourceId[]
  ): Promise<Record<ResourceId, ResourcePickerItem>> {
    const result: Record<ResourceId, ResourcePickerItem> = {}

    // Group by entityDefinitionId for efficient batching
    const grouped = new Map<string, string[]>()
    for (const resourceId of resourceIds) {
      const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
      if (!grouped.has(entityDefinitionId)) grouped.set(entityDefinitionId, [])
      grouped.get(entityDefinitionId)!.push(entityInstanceId)
    }
    // Fetch each group in parallel
    await Promise.all(
      Array.from(grouped.entries()).map(async ([entityDefinitionId, ids]) => {
        if (this.registryService.isCustomResource(entityDefinitionId)) {
          // Custom entity - fetch EntityInstances by IDs
          const resource = await this.registryService.getById(entityDefinitionId)
          const fetched = await this.fetchEntityInstancesByIds(resource!, ids)
          for (const item of fetched) result[item.resourceId] = item
        } else if (RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) {
          // System resource - use existing fetchResourcesFromDb with ID filter
          const { items: fetched } = await this.fetchResourcesFromDb(
            entityDefinitionId as TableId,
            ids.length,
            null,
            undefined,
            { id: ids }
          )
          for (const item of fetched) result[item.resourceId] = item
        }
      })
    )

    return result
  }

  /**
   * Fetch entity instances by IDs
   * Uses pre-computed display columns instead of field values
   */
  private async fetchEntityInstancesByIds(
    resource: CustomResource,
    ids: string[]
  ): Promise<ResourcePickerItem[]> {
    const instances = await this.db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.organizationId, this.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, resource.entityDefinitionId),
        inArray(schema.EntityInstance.id, ids)
      ),
    })

    return instances.map((inst) => this.transformEntityInstanceToPickerItem(resource, inst))
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
  async search(params: GlobalSearchParams): Promise<GlobalSearchResult> {
    const startTime = performance.now()
    const { query = '', entityDefinitionId, entityDefinitionIds, limit = 25, cursor } = params

    const trimmedQuery = query.trim()

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

    // Transform to ResourcePickerItem format
    const items: ResourcePickerItem[] = searchResults.map((row) => ({
      id: row.id,
      resourceId: toResourceId(row.entityDefinitionId, row.id),
      displayName: row.displayName || row.id,
      secondaryInfo: row.secondaryDisplayValue || undefined,
      avatarUrl: row.avatarUrl || undefined,
      data: {
        ...row,
        entityType: row.entityType,
        entityIcon: row.entityIcon,
        entityColor: row.entityColor,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    const processingTimeMs = performance.now() - startTime

    logger.debug('Global search completed', {
      query: trimmedQuery,
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

    // Transform to ResourcePickerItem format
    const items: ResourcePickerItem[] = results.map((row) => ({
      id: row.id,
      resourceId: toResourceId(row.entityDefinitionId, row.id),
      displayName: row.displayName || row.id,
      secondaryInfo: row.secondaryDisplayValue || undefined,
      avatarUrl: row.avatarUrl || undefined,
      data: {
        ...row,
        entityType: row.entityType,
        entityIcon: row.entityIcon,
        entityColor: row.entityColor,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    const processingTimeMs = performance.now() - startTime

    logger.debug('Recent entities fetched', {
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
}
