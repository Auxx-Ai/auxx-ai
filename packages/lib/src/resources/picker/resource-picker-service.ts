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
} from './types'

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
   * Supports both system resources (TableId) and custom entities (entity_xxx)
   */
  async getResources(input: GetResourcesInput): Promise<PaginatedResourcesResult> {
    const { entityDefinitionId, limit, cursor, search, filters, skipCache } = input

    // Check if it's a custom entity (entity_xxx format)
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
    const result = await this.fetchResourcesFromDb(entityDefinitionId as TableId, limit, cursor, search, filters)

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
   * Supports both system resources (TableId) and custom entities (entity_xxx)
   */
  async getResourceById(input: GetResourceByIdInput): Promise<ResourcePickerItem | null> {
    const { entityDefinitionId, id } = input

    // Check if it's a custom entity (entity_xxx format)
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
    const cached = await this.cache.getCachedSingleResource(this.organizationId, entityDefinitionId, id)
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
    filters: Record<string, any> | undefined,
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
        filters,
      )
    } else {
      return this.fetchResourcesDirect(tableId, table, displayConfig, limit, cursor, search, filters)
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
    filters: Record<string, any> | undefined,
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
                and(eq(table[sortField], sortValue), comparison(table.id, id)),
              )!,
            )
          }
        }

        // Search across configured fields
        if (search && search.trim()) {
          const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
            ilike(table[fieldKey], `%${search.trim()}%`),
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
    filters: Record<string, any> | undefined,
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
              sql`${table.id} ${sql.raw(eqComparison)} ${id}`,
            ),
          )!,
        )
      }
    }

    // Search across configured fields
    if (search && search.trim()) {
      const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
        ilike(table[fieldKey], `%${search.trim()}%`),
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
    id: string,
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

    const displayName =
      typeof displayConfig.displayNameField === 'string'
        ? row[displayConfig.displayNameField]
        : displayConfig.displayNameField(row)

    const secondaryInfo = displayConfig.secondaryInfoField
      ? typeof displayConfig.secondaryInfoField === 'string'
        ? row[displayConfig.secondaryInfoField]
        : displayConfig.secondaryInfoField(row)
      : undefined

    const avatarUrl = displayConfig.avatarField ? row[displayConfig.avatarField] : undefined

    return {
      id: row.id,
      entityDefinitionId: tableId,
      entityInstanceId,
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
      entityDefinitionId: resource.id,
      entityInstanceId: instance.id,
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
   * Works with both system resources (TableId) and custom entities (entity_slug)
   */
  async getResourcesByIds(
    items: Array<{ resourceId: string; id: string }>
  ): Promise<Record<string, ResourcePickerItem>> {
    const result: Record<string, ResourcePickerItem> = {}

    // Group by resourceId for efficient batching
    const grouped = new Map<string, string[]>()
    for (const { resourceId, id } of items) {
      if (!grouped.has(resourceId)) grouped.set(resourceId, [])
      grouped.get(resourceId)!.push(id)
    }

    // Fetch each group in parallel
    await Promise.all(
      Array.from(grouped.entries()).map(async ([resourceId, ids]) => {
        if (this.registryService.isCustomResource(resourceId)) {
          // Custom entity - fetch EntityInstances by IDs
          const resource = await this.registryService.getById(resourceId)
          if (resource && isCustomResource(resource)) {
            const fetched = await this.fetchEntityInstancesByIds(resource, ids)
            for (const item of fetched) result[item.id] = item
          }
        } else if (RESOURCE_TABLE_MAP[resourceId as TableId]) {
          // System resource - use existing fetchResourcesFromDb with ID filter
          const { items: fetched } = await this.fetchResourcesFromDb(
            resourceId as TableId,
            ids.length,
            null,
            undefined,
            { id: ids }
          )
          for (const item of fetched) result[item.id] = item
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
}
