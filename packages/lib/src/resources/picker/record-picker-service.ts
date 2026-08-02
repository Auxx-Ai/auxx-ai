// packages/lib/src/resources/picker/record-picker-service.ts

import { type Database, schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { isEntityDefinitionType, type RecordId } from '@auxx/types/resource'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import {
  getCachedEntityDefId,
  getCachedResource,
  getCachedResources,
  getOrgCache,
} from '../../cache'
import { BadRequestError, ForbiddenError } from '../../errors'
import { getRecordIdentitiesForRecords } from '../../identity'
import {
  articleRowAccess,
  knowledgeBaseScopeFingerprint,
  systemTableVisibilityScope,
  viewableKnowledgeBaseIds,
} from '../../permissions/capabilities/article-visibility-scope'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import {
  type InstanceAccessKey,
  isDeclaredInstanceDomain,
  isInstanceAccessKey,
} from '../../permissions/capabilities/instance-access'
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
import {
  type DynamicRow,
  type DynamicTable,
  requireColumn,
  resolveSchemaTable,
} from '../schema-table'
import {
  RECORD_SEARCH_COLUMNS_EI,
  recordSearchCursor,
  recordSearchNameScore,
  recordSearchPredicate,
  recordSearchRank,
  recordSearchTextScore,
} from '../search/record-search-sql'
import { isMailLensTableId, MAIL_LENS_REFUSAL } from './mail-lens-tables'
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
 * An instance-access resource the picker can serve from its OWN table — i.e. a
 * key that is simultaneously a blob-lane {@link InstanceAccessKey} and a
 * statically-pickable system table. Today that is exactly `kb` and `dataset`.
 *
 * Derived, never listed: `signature` and `snippet` are instance-access too, but
 * they carry no `RESOURCE_DISPLAY_CONFIG` entry, so `fetchResourcesFromDb`
 * cannot query them by hand and this returns `undefined` for them — which is
 * what keeps them refused at the router while these two are admitted.
 */
function systemTableInstanceAccessKey(entityDefinitionId: string): InstanceAccessKey | undefined {
  if (!isInstanceAccessKey(entityDefinitionId)) return undefined
  if (!RESOURCE_TABLE_MAP[entityDefinitionId as unknown as TableId]) return undefined
  if (!RESOURCE_DISPLAY_CONFIG[entityDefinitionId as unknown as TableId]) return undefined
  return entityDefinitionId
}

/**
 * A row's instance-access rung, read off the composed capability blob.
 *
 * The three predicates are already on {@link CapabilityView} (and already
 * intersected across run-as/invoker by its combining wrapper), so this walks
 * them highest-first rather than adding a fourth method that would have to
 * re-derive the same intersection. `undefined` ⇒ not viewable ⇒ the row drops.
 *
 * The vocabulary lines up on purpose: instance access uses `CONFIG_SCALE_RUNGS`
 * (`none|read|edit|admin`), the same ladder `_access` is judged on by
 * `canEditRecordAt` / `canDeleteRecordAt` and by `useRecordAccess` on the
 * client, so a stamped `kb` row gets correct row affordances for free.
 */
function instanceRung(
  capabilities: CapabilityView,
  key: InstanceAccessKey,
  instanceId: string
): Rung | undefined {
  if (capabilities.canAdminInstance(key, instanceId)) return 'admin'
  if (capabilities.canEditInstance(key, instanceId)) return 'edit'
  if (capabilities.canViewInstance(key, instanceId)) return 'read'
  return undefined
}

/**
 * The slice of Drizzle's relational query builder the dynamic picker paths use.
 * `db.query` is keyed by table name and `dbName` is only known at runtime, so
 * the builder is looked up by string and asserted against this narrow shape.
 */
interface DynamicQueryBuilder {
  findMany(config: {
    where?: (table: DynamicTable) => SQL | undefined
    orderBy?: (table: DynamicTable) => SQL[]
    limit?: number
    with?: Record<string, unknown>
  }): Promise<DynamicRow[]>
  findFirst(config: {
    where?: (table: DynamicTable) => SQL | undefined
  }): Promise<DynamicRow | undefined>
}

/** Resolve a registry `dbName` to its relational query builder. */
function resolveQueryBuilder(db: Database, dbName: string): DynamicQueryBuilder {
  const builder = (db.query as Record<string, unknown>)[dbName]
  if (!builder) {
    throw new Error(`No relational query builder for table: ${dbName}`)
  }
  return builder as DynamicQueryBuilder
}

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

    // Step 0.1 — refused BEFORE the picker cache, not just before the query: a
    // cached thread page is the same disclosure as a fresh one.
    if (isMailLensTableId(entityDefinitionId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)

    // Validate table exists in registry for system resources
    if (!RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) {
      throw new Error(`Unknown table: ${entityDefinitionId}`)
    }

    // 🔴 The VIEWER dimension of the cache key (plan v3/06 §5.5). This cache is
    // org-keyed and had no user dimension at all, so narrowing the fetch below
    // without it would serve the first caller's visible set to every other
    // member of the org — in both directions. A cached page is the same
    // disclosure as a fresh one, which is exactly the argument step 0.1 makes
    // for `thread`.
    //
    // `undefined` for every table that is not scope-bearing, so their keys are
    // byte-identical to the ones they had before this existed.
    const scopeKey = await this.systemTableScopeFingerprint(entityDefinitionId as TableId)

    // Check cache first
    if (!skipCache) {
      const cached = await this.cache.getCachedResources(this.organizationId, entityDefinitionId, {
        cursor,
        search,
        filters,
        scope: scopeKey,
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
      scope: scopeKey,
    })

    return result
  }

  /**
   * The org's viewable-KB allow-list for this request, memoized per service.
   *
   * One fold over one cached blob, shared by the SQL predicate and the cache-key
   * fingerprint — resolving it twice would be two folds with two chances to
   * disagree about the same member, and the disagreement mode is a cache entry
   * keyed by one answer holding rows selected by the other.
   */
  private viewableKbIdsPromise?: Promise<string[] | 'all'>
  private viewableKbIds(): Promise<string[] | 'all'> {
    this.viewableKbIdsPromise ??= viewableKnowledgeBaseIds(this.organizationId, this.capabilities)
    return this.viewableKbIdsPromise
  }

  /**
   * The cache-key discriminator for a system table, or `undefined` when the
   * table carries no viewer-dependent scope (every table but `article` today).
   */
  private async systemTableScopeFingerprint(tableId: TableId): Promise<string | undefined> {
    if (tableId !== 'article' || !this.capabilities) return undefined
    return knowledgeBaseScopeFingerprint(await this.viewableKbIds())
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

    // Step 0.1 — refused before the picker cache, as in `getResources`.
    if (isMailLensTableId(entityDefinitionId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)

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
   *
   * **The choke point for step 0.1, and for plan v3/06's R4/R5.** Every
   * `TableId`-driven multi-row read in this service funnels through here, so the
   * mail-lens refusal is asserted here rather than at each of the three call
   * sites. Callers that fan out over the whole registry pre-filter instead (see
   * {@link searchGlobalUnion}) so the refusal is never something they have to
   * catch.
   *
   * 🔴 **The article visibility predicate is applied HERE rather than in
   * `getResources`**, and that placement is what closes R4 *and* R5 in one edit:
   * the ranked scoped search (`record.search({entityDefinitionId:'article'})` →
   * `UnifiedCrudHandler.search` → `getResources`), the ⌘K/`@`-reference global
   * union (`searchGlobalUnion` calls this per system table directly, bypassing
   * `getResources` entirely) and the by-ids hydration all pass through this one
   * function. Applying it in `getResources` alone would have left the union arm
   * — the mention/reference pickers and the SDK — reading org-wide.
   *
   * On the by-ids path this is belt-and-braces over {@link admitSystemRows},
   * which still runs and is still what produces the `_access` stamp. Narrowing
   * in SQL first is strictly better: unauthorized ids never leave the database.
   */
  private async fetchResourcesFromDb(
    tableId: TableId,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, any> | undefined
  ): Promise<PaginatedResourcesResult> {
    if (isMailLensTableId(tableId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
    // Def-backed types carry no static display config — the picker cannot query them by hand.
    if (!displayConfig) throw new BadRequestError(`Resource ${tableId} is not statically pickable`)
    const tableName = tableConfig.dbName

    // Read enforcement (§5.2). Arm `none` returns an empty page WITHOUT querying;
    // arm `restricted` hands the predicate down to whichever builder runs.
    const scope = await this.recordScope(tableId)
    if (scope.arm === 'none') return { items: [], nextCursor: null }

    // Determine organization scoping strategy
    const scopingStrategy = displayConfig.orgScopingStrategy || 'direct'

    // Build query based on scoping strategy
    if (scopingStrategy === 'join' && displayConfig.joinScoping) {
      // Get Drizzle table reference (the join path builds SQL by hand)
      const table = resolveSchemaTable(tableName)
      return this.fetchResourcesWithJoin(
        tableId,
        table,
        displayConfig,
        limit,
        cursor,
        search,
        filters,
        scope.where
      )
    } else {
      return this.fetchResourcesDirect(
        tableId,
        displayConfig,
        limit,
        cursor,
        search,
        filters,
        scope.where
      )
    }
  }

  /**
   * Fetch resources with direct organization scoping (has organizationId column)
   * Uses Drizzle's relational query API (db.query.TableName.findMany())
   */
  private async fetchResourcesDirect(
    tableId: TableId,
    displayConfig: ResourceDisplayConfig,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, unknown> | undefined,
    /**
     * Per-row read enforcement (plan v3/06 §5.2). Table-qualified, so it is only
     * ever valid for the `tableId` it was built for — and it survives Drizzle's
     * relational query builder, whose top-level `FROM` is `"Article" "Article"`
     * (verified against dev, not assumed).
     */
    visibilityWhere?: SQL
  ): Promise<PaginatedResourcesResult> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const tableName = tableConfig.dbName
    const sortField = displayConfig.defaultSortField || 'updatedAt'
    const sortDirection = displayConfig.defaultSortDirection || 'desc'

    // Execute query using relational API
    const items = await resolveQueryBuilder(this.db, tableName).findMany({
      where: (table) => {
        const conditions: SQL[] = []
        // FIRST, before the caller's filters and before `neverPickable`, so no
        // later branch can widen past it.
        if (visibilityWhere) conditions.push(visibilityWhere)

        // Organization scoping
        const orgColumn = table.organizationId
        if (orgColumn) {
          conditions.push(eq(orgColumn, this.organizationId))
        }

        // Cursor pagination
        if (cursor) {
          const [sortValue, id] = cursor.split('|')
          if (sortValue && id) {
            const comparison = sortDirection === 'desc' ? lt : gt
            const sortColumn = requireColumn(table, sortField)
            const idColumn = requireColumn(table, 'id')

            conditions.push(
              or(
                comparison(sortColumn, sortValue),
                and(eq(sortColumn, sortValue), comparison(idColumn, id))
              )!
            )
          }
        }

        // Search across configured fields
        if (search?.trim()) {
          const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
            ilike(requireColumn(table, fieldKey), `%${search.trim()}%`)
          )
          if (searchConditions.length > 0) {
            conditions.push(or(...searchConditions)!)
          }
        }

        // Rows this table never exposes through the picker (e.g. `kind: 'source'`
        // knowledge bases). Applied before caller filters so no caller can opt out.
        for (const [fieldKey, excluded] of Object.entries(displayConfig.neverPickable ?? {})) {
          const column = table[fieldKey]
          if (column && excluded.length > 0) conditions.push(notInArray(column, [...excluded]))
        }

        // Apply custom filters
        if (filters) {
          Object.entries(filters).forEach(([fieldKey, value]) => {
            // Filters are caller-supplied, so an unknown key is skipped, not fatal.
            const column = table[fieldKey]
            if (value === undefined || value === null || !column) return
            if (Array.isArray(value)) {
              conditions.push(inArray(column, value))
            } else {
              conditions.push(eq(column, value))
            }
          })
        }

        return conditions.length > 0 ? and(...conditions) : undefined
      },
      orderBy: (table) => {
        const orderFn = sortDirection === 'desc' ? desc : asc
        return [orderFn(requireColumn(table, sortField)), orderFn(requireColumn(table, 'id'))]
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
    table: DynamicTable,
    displayConfig: ResourceDisplayConfig,
    limit: number,
    cursor: string | null | undefined,
    search: string | undefined,
    filters: Record<string, unknown> | undefined,
    /**
     * See {@link fetchResourcesDirect}. No scope-bearing table uses the join
     * strategy today (`article` is `direct`), but the parameter is threaded so a
     * table that switches strategy cannot silently lose its enforcement.
     */
    visibilityWhere?: SQL
  ): Promise<PaginatedResourcesResult> {
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const joinConfig = displayConfig.joinScoping!
    const joinTable = resolveSchemaTable(joinConfig.joinTable)

    const conditions: SQL[] = []
    if (visibilityWhere) conditions.push(visibilityWhere)
    const idColumn = requireColumn(table, 'id')

    // Organization scoping via join table
    conditions.push(eq(requireColumn(joinTable, joinConfig.joinOrgKey), this.organizationId))

    // Additional conditions from config (e.g., userType = 'USER')
    if (joinConfig.additionalConditions) {
      Object.entries(joinConfig.additionalConditions).forEach(([key, value]) => {
        // Apply condition directly - column existence is guaranteed by config
        conditions.push(eq(requireColumn(table, key), value))
      })
    }

    // Cursor pagination
    const sortField = displayConfig.defaultSortField || 'updatedAt'
    const sortDirection = displayConfig.defaultSortDirection || 'desc'
    const sortColumn = requireColumn(table, sortField)

    if (cursor) {
      const [sortValue, id] = cursor.split('|')
      if (sortValue && id) {
        const comparison = sortDirection === 'desc' ? '<' : '>'

        conditions.push(
          or(
            sql`${sortColumn} ${sql.raw(comparison)} ${sortValue}`,
            and(sql`${sortColumn} = ${sortValue}`, sql`${idColumn} ${sql.raw(comparison)} ${id}`)
          )!
        )
      }
    }

    // Search across configured fields
    if (search?.trim()) {
      const searchConditions = displayConfig.searchFields.map((fieldKey: string) =>
        ilike(requireColumn(table, fieldKey), `%${search.trim()}%`)
      )
      if (searchConditions.length > 0) {
        conditions.push(or(...searchConditions)!)
      }
    }

    // Apply custom filters
    if (filters) {
      Object.entries(filters).forEach(([fieldKey, value]) => {
        // Filters are caller-supplied, so an unknown key is skipped, not fatal.
        const column = table[fieldKey]
        if (value === undefined || value === null || !column) return
        if (Array.isArray(value)) {
          conditions.push(inArray(column, value))
        } else {
          conditions.push(eq(column, value))
        }
      })
    }

    // Execute query with join
    const orderByClause =
      sortDirection === 'desc'
        ? [desc(sortColumn), desc(idColumn)]
        : [asc(sortColumn), asc(idColumn)]

    // Drizzle cannot type a join whose tables are only known at runtime; the row
    // is keyed by table name, each value being that table's column bag.
    const items = (await this.db
      .select()
      .from(joinTable)
      .innerJoin(
        table,
        eq(
          requireColumn(joinTable, joinConfig.joinSourceKey),
          requireColumn(table, joinConfig.mainTableKey)
        )
      )
      .where(and(...conditions))
      .orderBy(...orderByClause)
      .limit(limit + 1)) as Array<Record<string, DynamicRow>>

    // Extract main table data from join result
    const tableName = tableConfig.dbName
    const extractedItems = items.map((row) => row[tableName]).filter((row) => row !== undefined)

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
   *
   * The single-row twin of {@link fetchResourcesFromDb}'s choke point: holding a
   * thread id is not a lens, so an id-addressed read is refused for the same
   * reason an enumeration is (step 0.1).
   */
  private async fetchSingleResourceFromDb(
    tableId: TableId,
    id: string
  ): Promise<RecordPickerItem | null> {
    if (isMailLensTableId(tableId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)
    const tableConfig = RESOURCE_TABLE_MAP[tableId]
    const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
    // Def-backed types carry no static display config — the picker cannot query them by hand.
    if (!displayConfig) throw new BadRequestError(`Resource ${tableId} is not statically pickable`)
    const tableName = tableConfig.dbName

    const scopingStrategy = displayConfig.orgScopingStrategy || 'direct'

    let item: DynamicRow | undefined

    if (scopingStrategy === 'join' && displayConfig.joinScoping) {
      // Fetch with join
      const joinConfig = displayConfig.joinScoping
      const table = resolveSchemaTable(tableName)
      const joinTable = resolveSchemaTable(joinConfig.joinTable)

      const conditions: SQL[] = [
        eq(requireColumn(table, 'id'), id),
        eq(requireColumn(joinTable, joinConfig.joinOrgKey), this.organizationId),
      ]

      if (joinConfig.additionalConditions) {
        Object.entries(joinConfig.additionalConditions).forEach(([key, value]) => {
          // Apply condition directly - column existence is guaranteed by config
          conditions.push(eq(requireColumn(table, key), value))
        })
      }

      // Runtime-resolved join tables (see `fetchResourcesWithJoin`).
      const [result] = (await this.db
        .select()
        .from(joinTable)
        .innerJoin(
          table,
          eq(
            requireColumn(joinTable, joinConfig.joinSourceKey),
            requireColumn(table, joinConfig.mainTableKey)
          )
        )
        .where(and(...conditions))
        .limit(1)) as Array<Record<string, DynamicRow>>

      item = result ? result[tableName] : undefined
    } else {
      // Fetch with direct scoping using relational API
      item = await resolveQueryBuilder(this.db, tableName).findFirst({
        where: (table) => {
          const conditions: SQL[] = [eq(requireColumn(table, 'id'), id)]

          const orgColumn = table.organizationId
          if (orgColumn) {
            conditions.push(eq(orgColumn, this.organizationId))
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
    if (!displayConfig) throw new BadRequestError(`Resource ${tableId} is not statically pickable`)

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
      createdAt: Date
      updatedAt: Date
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
      // Step 0.1 — thread/message ids DROP from the batch rather than throwing.
      // A batch is a hydration call for ids the caller already holds (a
      // relationship value, an `_access` stamp); one unreachable id must not
      // fail the other ninety-nine, and silent omission is already this
      // method's documented answer for an id the member cannot reach.
      if (isMailLensTableId(entityDefinitionId)) continue
      if (!grouped.has(entityDefinitionId)) grouped.set(entityDefinitionId, [])
      grouped.get(entityDefinitionId)!.push(entityInstanceId)
    }

    // Read enforcement (plan v3/03 §5.1/§5.2): drop groups the member cannot
    // reach AT ALL (arm 4 — no def view and no grants), and remember the scope
    // for the ones that survive so the per-row predicate + `_access` stamp ride
    // the fetch below. Unauthorized ids DROP SILENTLY from the batch — the
    // caller's map simply has no entry — matching `getById`'s non-enumeration.
    //
    // System tables answer `{ arm: 'all' }` here and are gated one layer down
    // instead — see {@link admitSystemRows} for why the instance-access ones
    // (`kb`, `dataset`) need that and where their per-row policy actually lives.
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
          if (!resource || !isCustomResource(resource)) {
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
              for (const item of await this.admitSystemRows(tableId, fetched)) {
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
          for (const item of await this.admitSystemRows(resolvedId as TableId, fetched)) {
            result[item.recordId] = item
          }
        }
      })
    )

    await this.attachRecordSources(result)
    return result
  }

  /**
   * **The per-row gate for system-table rows** — the half of §5.1/§5.2 that
   * `fetchResourcesFromDb` cannot express.
   *
   * The EntityInstance path narrows in SQL (`scope.where`) and stamps `_access`
   * from the grantee-union rank in the same projection. A system table has
   * neither: its rows carry no `ResourceAccess` grant rows to correlate against,
   * and `recordScope` says so by answering `{ arm: 'all' }`. For the
   * instance-access keys among them (`kb`, `dataset`) that would be a leak — the
   * whole org's knowledge bases to any member — so the fetch is filtered here,
   * in memory, against the same authority `kb.list` uses (`canViewInstance`).
   *
   * Rows the member cannot view DROP SILENTLY, matching this method's answer for
   * every other unreachable id.
   *
   * 🔴 **`article` is gated too, and its old pass-through was the bug** (plan
   * v3/06 §2.2). This docstring used to say `article` "genuinely has no per-row
   * policy in this lane"; it has one, it just lives ONE HOP AWAY on its knowledge
   * base. `article` is not an {@link isInstanceAccessKey} — it is not itself a
   * grant target and must never become one — so it takes its own branch rather
   * than joining `kb` / `dataset`. The remaining genuine pass-throughs are
   * `user`, `participant` and `visit`.
   *
   * `capabilities: undefined` ⇒ internal caller ⇒ no enforcement, the same
   * convention `recordScope` and `fetchEntityInstancesByIds` follow. That is
   * load-bearing for headless work (article sync, embedding jobs, `apps/kb`
   * rendering, the widget API), so the short-circuit must stay ABOVE every
   * branch — including the batched placement read, which must not fire at all
   * for an unenforced caller.
   */
  private async admitSystemRows(
    tableId: TableId,
    fetched: RecordPickerItem[]
  ): Promise<RecordPickerItem[]> {
    const capabilities = this.capabilities
    if (!capabilities || fetched.length === 0) return fetched

    if (tableId === 'article') return this.admitArticleRows(fetched, capabilities)

    const key = systemTableInstanceAccessKey(tableId)
    if (!key) return fetched

    const admitted: RecordPickerItem[] = []
    for (const item of fetched) {
      const access = instanceRung(capabilities, key, item.id)
      if (!access) continue
      admitted.push({ ...item, _access: access })
    }
    return admitted
  }

  /**
   * The `article` branch of {@link admitSystemRows} (plan v3/06 W3 + P2).
   *
   * An article is reachable through any of its **placements** as well as its
   * home KB (§5.2), and neither is on the fetched row except `homeKnowledgeBaseId`
   * — so the placement set is resolved with **ONE batched read over
   * `ArticlePlacement` for the whole fetched set**. Never per row: `getByIds`
   * caps at 100 ids and a per-row lookup would turn one hydration into 100
   * queries. This is the only new I/O in plan v3/06.
   *
   * The stamp is `articleRowAccess` — home-strict above `read`, so a linked
   * placement the member administers does not license rewriting content the home
   * KB owns (§7.3). Once it exists, `assertRecordRowsEditable` re-judges
   * def-denied article rows against it, which is what gives a
   * `knowledgeBase: Edit` / `records: None` member back their inline tag editing
   * (§7.2).
   */
  private async admitArticleRows(
    fetched: RecordPickerItem[],
    capabilities: CapabilityView
  ): Promise<RecordPickerItem[]> {
    const viewable = await viewableKnowledgeBaseIds(this.organizationId, capabilities)
    if (viewable === 'all') return fetched
    // No viewable KB at all ⇒ no article is reachable, and the placement read
    // would only confirm it. Skip the query.
    if (viewable.length === 0) return []
    const viewableKbIds = new Set(viewable)

    const placements = await this.db
      .select({
        articleId: schema.ArticlePlacement.articleId,
        knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId,
      })
      .from(schema.ArticlePlacement)
      .where(
        and(
          eq(schema.ArticlePlacement.organizationId, this.organizationId),
          inArray(
            schema.ArticlePlacement.articleId,
            fetched.map((item) => item.id)
          )
        )
      )

    const placementKbIdsByArticle = new Map<string, string[]>()
    for (const row of placements) {
      const existing = placementKbIdsByArticle.get(row.articleId)
      if (existing) existing.push(row.knowledgeBaseId)
      else placementKbIdsByArticle.set(row.articleId, [row.knowledgeBaseId])
    }

    const admitted: RecordPickerItem[] = []
    for (const item of fetched) {
      const homeKnowledgeBaseId = (item.data as { homeKnowledgeBaseId?: string | null })
        .homeKnowledgeBaseId
      const access = articleRowAccess({
        capabilities,
        placementKbIds: placementKbIdsByArticle.get(item.id) ?? [],
        homeKnowledgeBaseId,
        viewableKbIds,
      })
      if (!access) continue
      admitted.push({ ...item, _access: access })
    }
    return admitted
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
   *
   * Also returns undefined for the mail-lens tables (step 0.1): this is the one
   * place a caller can reach a `TableId` by a UUID it never typed, so leaving it
   * open would let a `thread` EntityDefinition id walk back into the direct
   * fetch by a route the slug guards never see.
   */
  private async reverseEntityDefToTableId(
    entityDefinitionId: string
  ): Promise<TableId | undefined> {
    const entityDefs = await getOrgCache().get(this.organizationId, 'entityDefs')
    const entityType = Object.entries(entityDefs).find(
      ([, defId]) => defId === entityDefinitionId
    )?.[0]
    if (!entityType) return undefined
    if (isMailLensTableId(entityType)) return undefined
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
    // Step 0.1 — `{ arm: 'all' }` for a `TableId` is the record lane admitting it
    // has no per-row policy for system tables. For mail content that is the
    // wrong answer, and `none` is the right one: the lens lives in `mail-query/`,
    // so from the record lane's point of view no thread row is reachable.
    if (isMailLensTableId(entityDefinitionId)) return { arm: 'none' }
    // ⚠ `{ arm: 'all' }` for a system table is NOT "everyone sees everything" for
    // the instance-access ones (`kb`, `dataset`). Their policy is real, it just
    // is not SQL: it lives in the composed capability blob, so
    // `getResourcesByIds` filters those rows through {@link instanceRung} AFTER
    // the fetch.
    //
    // That filter is on the by-ids (hydration) path only. `getResources` — the
    // paginated list path — is still unfiltered for these keys, which is safe
    // solely because `record.ts` refuses them there. Widen that guard and this
    // has to grow a list arm first.
    //
    // 🔴 `article` is the one system table whose per-row policy IS expressible
    // as SQL (plan v3/06 W2) — it inherits its KB's instance grants. This
    // delegation mirrors `UnifiedCrudHandler.systemTableScope`; the picker is a
    // second entry point into ONE lane, not a second policy.
    //
    // What it buys HERE is the `'none'` arm: a member with no viewable KB drops
    // the whole article group out of `getResourcesByIds` before any fetch. The
    // `'restricted'` arm's `where` is qualified to `"Article"` and is deliberately
    // NOT consumed on this path — the by-ids fetch goes through
    // {@link admitSystemRows}, which applies the same policy in memory because
    // the rows are already fetched by then.
    if (RESOURCE_TABLE_MAP[entityDefinitionId as TableId]) {
      // ⚠ The allow-list is resolved ONLY for the table that needs it. Hoisting
      // it above this branch made every system-table picker read (`kb`,
      // `dataset`, `participant`, …) fetch the KB blob for a scope they can
      // never use — caught by `system-table-instance-access.test.ts`, which is
      // exactly the kind of quiet extra I/O a test that mocks only what it needs
      // is good at noticing.
      if (entityDefinitionId !== 'article') return { arm: 'all' }
      const memoKey = `system:${entityDefinitionId}`
      const memoized = this.scopeCache.get(memoKey)
      if (memoized) return memoized
      // Resolved ONCE per service and shared with the cache-key fingerprint —
      // see {@link viewableKbIds}.
      const pending = this.viewableKbIds().then((viewableKbIds) =>
        systemTableVisibilityScope({
          organizationId: this.organizationId,
          tableId: entityDefinitionId,
          capabilities: this.capabilities,
          viewableKbIds,
        })
      )
      this.scopeCache.set(memoKey, pending)
      return pending
    }
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
      cursorFilter = sql`AND ${recordSearchCursor(
        trimmedQuery,
        cursorScore,
        cursorId,
        RECORD_SEARCH_COLUMNS_EI
      )}`
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
          ${recordSearchTextScore(trimmedQuery, RECORD_SEARCH_COLUMNS_EI)} as text_score,
          -- Trigram similarity on displayName (for typo tolerance)
          ${recordSearchNameScore(trimmedQuery, RECORD_SEARCH_COLUMNS_EI)} as name_score,
          -- Combined score for ranking — ONE definition, shared with the cursor
          -- filter above and with the mail binding (search/text-search-sql.ts).
          ${recordSearchRank(trimmedQuery, RECORD_SEARCH_COLUMNS_EI)} as combined_score
        FROM "EntityInstance" ei
        JOIN "EntityDefinition" ed ON ei."entityDefinitionId" = ed.id
        WHERE
          ei."organizationId" = ${this.organizationId}
          AND ei."archivedAt" IS NULL
          -- tsvector match OR trigram (fuzzy) OR ILIKE fallback for short queries
          AND ${recordSearchPredicate(trimmedQuery, RECORD_SEARCH_COLUMNS_EI)}
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
    // Step 0.1 — the mail-content tables are dropped from the fan-out BEFORE the
    // per-kind cap is computed, so excluding them widens the remaining buckets
    // instead of silently shortening the page with legs that would only throw.
    // This is the entry point the decision was written for: `thread` is a
    // registered system resource table, so the global record search had a thread
    // leg served by the plain `ilike` direct fetch with no mail lens at all.
    const tableIds = (Object.keys(RESOURCE_TABLE_MAP) as TableId[]).filter(
      (tableId) => !isMailLensTableId(tableId)
    )
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
          AND ${recordSearchPredicate(trimmedQuery, RECORD_SEARCH_COLUMNS_EI)}
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
