// packages/lib/src/resources/crud/unified-handler-queries.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  type FieldId,
  type FieldReference,
  parseResourceFieldId,
  type ResourceFieldId,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { and, asc, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import {
  findCachedResource,
  getCachedEntityDefId,
  getCachedResourceFields,
  getOrgCache,
} from '../../cache'
import type { ConditionGroup } from '../../conditions'
import { FieldValueService, formatToRawValue } from '../../field-values'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { BaseType } from '../../workflow-engine/core/types'
import type { DroppedCondition } from '../query-builder/base-condition-builder'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../query-builder/system-condition-builder'
import {
  getFieldOutputKey,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
  type ResourceField,
} from '../registry'
import type { TableId } from '../registry/field-registry'
import type { ResourceRegistryService } from '../registry/resource-registry-service'
import { type RecordId, toRecordId } from '../resource-id'
import { recordSearchPredicate, recordSearchRank } from '../search/record-search-sql'

const logger = createScopedLogger('unified-handler-queries')

/** Type for EntityInstance select */
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/**
 * Input for listFiltered query
 */
export interface ListFilteredInput {
  /** Resource type: 'contact', 'ticket', or custom entity UUID */
  entityDefinitionId: string
  /** Filter groups (optional) */
  filters?: ConditionGroup[]
  /**
   * Free-text search from the search bar — a separate axis from {@link filters},
   * not a condition (plan decision 0.3). Conditions narrow the search; this IS
   * the search. Ranked + typo-tolerant; only meaningful for EntityInstance-backed
   * definitions (system tables have no `searchText` corpus).
   */
  search?: string
  /** Sort configuration (optional) */
  sorting?: Array<{ id: string; desc: boolean }>
  /** Limit per request (default: 100) */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Cursor for pagination (what tRPC's infinite query threads through) */
  cursor?: { offset: number }
  /**
   * Force the `COUNT(*)`. Defaults to `offset === 0` — the first page pays for the
   * total, later pages don't. Pass `true` when a caller needs the full count on a
   * deep page (paginating agent tools).
   */
  includeTotal?: boolean
}

/**
 * Result from listFiltered query
 */
export interface ListFilteredResult {
  /** Array of record IDs */
  ids: string[]
  /**
   * Total count matching filters. Present only when the COUNT ran (first page, or
   * an explicit `includeTotal`). Display data — {@link hasMore} is pagination truth.
   */
  total?: number
  /** Whether more results exist, derived from a `limit + 1` probe row */
  hasMore: boolean
}

/**
 * Scan conditions to identify which related entities are needed.
 * Returns set of relatedEntityDefinitionIds.
 *
 * @param filters - Condition groups to scan
 * @param sourceFields - Fields of the source entity
 */
export function extractRequiredRelatedEntities(
  filters: ConditionGroup[],
  sourceFields: ResourceField[]
): Set<string> {
  const relatedEntityIds = new Set<string>()

  for (const group of filters) {
    for (const condition of group.conditions) {
      const fieldRef = condition.fieldId
      let relationshipFieldKey: string | undefined

      // Array format: ['ticket:contact', 'contact:email']
      if (Array.isArray(fieldRef) && fieldRef.length >= 2) {
        const relationshipRef = fieldRef[0]
        relationshipFieldKey =
          typeof relationshipRef === 'string' && relationshipRef.includes(':')
            ? parseResourceFieldId(relationshipRef as ResourceFieldId).fieldId
            : relationshipRef
      }
      // Dot notation: 'contact.email'
      else if (typeof fieldRef === 'string' && fieldRef.includes('.')) {
        relationshipFieldKey = fieldRef.split('.')[0]
      } else {
        continue
      }

      if (!relationshipFieldKey) continue

      // Find relationship field in source fields
      const relationshipField = sourceFields.find(
        (f) =>
          getFieldOutputKey(f) === relationshipFieldKey ||
          f.key === relationshipFieldKey ||
          (f.id && f.id === relationshipFieldKey)
      )

      if (relationshipField?.relationship) {
        const relatedEntityId = getRelatedEntityDefinitionId(
          relationshipField.relationship as RelationshipConfig
        )
        if (relatedEntityId) {
          relatedEntityIds.add(relatedEntityId)
        }
      }
    }
  }

  return relatedEntityIds
}

/**
 * Internal: build the context, WHERE clause, and ORDER BY clauses for an entity-instance
 * query. Shared between the paged and count-only helpers so we don't duplicate field
 * resolution + related-entity lookups.
 *
 * `search` is the free-text half of the records search bar, kept OUT of
 * `filters` on purpose (plan decision 0.3): conditions **narrow**, the typed text
 * **is** the search. It is `AND`-ed into the WHERE clause — never OR-ed with the
 * filters — and, when the user has not picked a sort column, it also supplies the
 * default ordering.
 */
async function buildEntityInstanceQueryParts(params: {
  organizationId: string
  entityDefinitionId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  /** Free-text query from the search bar. Blank/whitespace is treated as absent. */
  search?: string
}): Promise<{
  whereClause: SQL<unknown> | undefined
  orderByClauses: SQL<unknown>[] | undefined
}> {
  const { organizationId, entityDefinitionId, filters, sorting } = params
  const search = params.search?.trim() || undefined

  const context = await buildEntityQueryContext(organizationId, entityDefinitionId, filters)

  const built = entityConditionBuilder.buildGroupedQueryWithDiagnostics(filters, context)

  if (built.droppedConditions.length > 0) {
    // Structured, not a JSON.stringify'd sentence — "how often does this happen
    // in production" has to be a query on `droppedCount` / `droppedConditions`,
    // not a grep. This path deliberately proceeds: the records list and stored
    // views must still render when a filter names a retired field. The AI
    // boundary escalates instead, via `inspectFilterConditions`.
    logger.warn('Dropped filter conditions', {
      entityDefinitionId,
      organizationId,
      droppedCount: built.droppedConditions.length,
      requestedConditions: built.requestedConditions,
      allConditionsDropped: built.allConditionsDropped,
      droppedConditions: built.droppedConditions,
    })
  }

  // Search NARROWS. `and()` drops `undefined`, so a filter-less search and a
  // search-less filter both fall out of the same expression.
  const whereClause = search ? and(built.sql, recordSearchPredicate(search)) : built.sql

  // An explicit column sort beats relevance [decision, plan §3.3b]: sorting by
  // name and watching rows reorder by score would read as a bug. Rank is the
  // DEFAULT ordering, not an override.
  //
  // `updatedAt DESC` sits under rank (matching the picker) because rank ties are
  // the common case, not the exception — every row that matches only the ILIKE
  // fallback scores 0. The caller appends `id ASC` as the final tie-break.
  const orderByClauses =
    sorting.length > 0
      ? entityConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          context
        )
      : search
        ? [desc(recordSearchRank(search)), desc(schema.EntityInstance.updatedAt)]
        : undefined

  return { whereClause, orderByClauses }
}

/**
 * Resolve the fields + related-entity fields an {@link EntityQueryContext} needs
 * for a given filter set. Shared by the query path and the AI-boundary
 * preflight so both see exactly the same field universe.
 */
async function buildEntityQueryContext(
  organizationId: string,
  entityDefinitionId: string,
  filters: ConditionGroup[]
): Promise<EntityQueryContext> {
  // Get fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefinitionId)

  // Inject `displayName` as a virtual filterable/sortable field — it is a
  // denormalized column on `EntityInstance`, not a `FieldValue` row, so it has no
  // entry in the resource-fields cache.
  //
  // This USED to be how the records search bar got its free text into SQL
  // (`displayName contains` → `ILIKE '%q%'`). Step 2.4 moved that onto the
  // `search` param, but the field STAYS: `displayName contains` is still a
  // legitimate explicit filter, it is what the KB articles table and any stored
  // view carrying such a condition still emit, and dropping it would fail OPEN —
  // the condition would be discarded and the list would silently widen.

  const fieldsWithDisplayName = fields.some((f) => f.key === 'displayName')
    ? fields
    : [
        ...fields,
        {
          id: toFieldId('displayName'),
          key: 'displayName',
          label: 'Display Name',
          name: 'Display Name',
          type: BaseType.STRING,
          fieldType: 'TEXT' as FieldType,
          isSystem: true,
          dbColumn: 'displayName',
          nullable: true,
          showInPanel: false,
          capabilities: {
            filterable: true,
            sortable: true,
            creatable: false,
            updatable: false,
            configurable: false,
          },
        } satisfies ResourceField,
      ]

  // Detect required related entities from filters
  const requiredRelatedEntities = extractRequiredRelatedEntities(filters, fieldsWithDisplayName)

  // Build relatedEntityFields map from org cache
  const relatedEntityFields: Record<string, ResourceField[]> = {}
  for (const relatedEntityId of requiredRelatedEntities) {
    const relatedFields = await getCachedResourceFields(organizationId, relatedEntityId)
    relatedEntityFields[relatedEntityId] = relatedFields
  }

  return {
    fields: fieldsWithDisplayName,
    outerTable: schema.EntityInstance,
    relatedEntityFields,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-BOUNDARY PREFLIGHT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a filter set does when it reaches the query builder, without running the
 * query. Every field is diagnostic — nothing here changes the SQL.
 */
export interface FilterConditionReport {
  /** Total conditions across every group. */
  requestedConditions: number
  /**
   * Conditions the builder could not turn into SQL. **A non-empty list means
   * the query would return MORE rows than the caller asked for** — the fail-open.
   */
  dropped: DroppedCondition[]
  /** `true` when conditions were requested and none of them produced SQL. */
  allConditionsDropped: boolean
  /**
   * `validateConditionGroups` output — unknown field, missing operator, missing
   * value, invalid option value. A condition can appear here without being
   * dropped (it built, but into something the caller didn't mean).
   */
  validationErrors: string[]
  /**
   * Caller-facing sentence, present **only** when something is wrong.
   * `undefined` ⇒ every requested condition made it into the WHERE clause and
   * the result set is honest.
   */
  message?: string
}

/**
 * Preflight a filter set at an AI tool boundary.
 *
 * The records list, stored views and dashboard widgets deliberately fail open —
 * a view naming a retired field still renders, just wider. An AI tool must not:
 * a dropped filter turns "3 open tickets" into "all 6,470 tickets" with no
 * signal that the filter was ignored. Call this before running the query and
 * return `message` as a tool error when it is set.
 *
 * Dispatches on {@link isSystemResource}, so the same call covers entity
 * definitions and system tables.
 *
 * @param params.entityDefinitionId - Entity definition id, or a system `TableId`
 */
export async function inspectFilterConditions(params: {
  organizationId: string
  entityDefinitionId: string
  filters: ConditionGroup[]
}): Promise<FilterConditionReport> {
  const { organizationId, entityDefinitionId, filters } = params

  const { built, validation } = isSystemResource(entityDefinitionId)
    ? {
        built: systemConditionBuilder.buildGroupedQueryWithDiagnostics(
          filters,
          entityDefinitionId as TableId
        ),
        validation: systemConditionBuilder.validateConditionGroups(
          filters,
          entityDefinitionId as TableId
        ),
      }
    : await (async () => {
        const context = await buildEntityQueryContext(organizationId, entityDefinitionId, filters)
        return {
          built: entityConditionBuilder.buildGroupedQueryWithDiagnostics(filters, context),
          validation: entityConditionBuilder.validateConditionGroups(filters, context),
        }
      })()

  const dropped = built.droppedConditions
  const validationErrors = validation.valid ? [] : validation.errors

  return {
    requestedConditions: built.requestedConditions,
    dropped,
    allConditionsDropped: built.allConditionsDropped,
    validationErrors,
    message: describeFilterProblems(dropped, validationErrors),
  }
}

/**
 * One sentence an LLM can act on: which filters were ignored, and why.
 * `undefined` when there is nothing to report.
 */
function describeFilterProblems(
  dropped: DroppedCondition[],
  validationErrors: string[]
): string | undefined {
  if (dropped.length === 0 && validationErrors.length === 0) return undefined

  const parts: string[] = []

  if (dropped.length > 0) {
    const names = dropped
      .map((d) => {
        const ref = Array.isArray(d.fieldRef) ? d.fieldRef.join('.') : d.fieldRef
        return `'${ref}' ${d.operator}`
      })
      .join(', ')
    parts.push(
      `${dropped.length} filter condition(s) could not be applied and were ignored: ${names}. ` +
        `Running this query would return records that do NOT match them.`
    )
  }

  if (validationErrors.length > 0) {
    parts.push(`Filter validation: ${validationErrors.join('; ')}.`)
  }

  parts.push('Call list_entity_fields to check field ids and operators, then retry.')

  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGED + COUNT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paged id query: `SELECT id ... LIMIT n + 1 OFFSET m`, optionally in parallel with
 * `COUNT(*)` over the same WHERE clause. Adds `EntityInstance.id ASC` as a deterministic
 * tie-break so OFFSET paging is stable when the sort column has ties.
 *
 * `hasMore` comes from the `limit + 1` probe row, never from `offset + ids.length < total`
 * — the probe stays honest under concurrent inserts/deletes, a stored total drifts.
 *
 * @returns `ids` (length ≤ limit), `hasMore`, and `total` only when `includeTotal`.
 */
export async function queryEntityInstanceIdsPaged(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  limit: number
  offset: number
  /**
   * Free-text search (plan step 2.4). ANDs the ranked predicate into `baseWhere`
   * — which the page query AND the `COUNT(*)` share, so `total` describes the
   * searched set — and, absent an explicit `sorting`, orders by relevance.
   */
  search?: string
  /** Run the parallel `COUNT(*)`. Callers pay for it on the first page only. */
  includeTotal?: boolean
  /**
   * The §5.1 per-record visibility predicate, from
   * {@link import('../../permissions/capabilities/record-visibility-scope').recordVisibilityScope}.
   *
   * Joined into `baseWhere`, which the page query AND the `COUNT(*)` both read —
   * so `total` stays honest over the VISIBLE set rather than describing rows the
   * member cannot open. `undefined` = arm 1 (the member sees every row): no
   * predicate is added and the query is byte-identical to the pre-P5 one.
   */
  visibilityWhere?: SQL
}): Promise<{ ids: string[]; total?: number; hasMore: boolean }> {
  const { db, entityDefinitionId, organizationId, filters, sorting, limit, offset } = params

  const { whereClause, orderByClauses } = await buildEntityInstanceQueryParts({
    organizationId,
    entityDefinitionId,
    filters,
    sorting,
    search: params.search,
  })

  const baseWhere = and(
    eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
    eq(schema.EntityInstance.organizationId, organizationId),
    isNull(schema.EntityInstance.archivedAt),
    whereClause,
    params.visibilityWhere
  )

  // Deterministic tie-break: append id ASC so OFFSET paging is stable when the
  // user-chosen sort column has ties.
  const finalOrderBy = orderByClauses
    ? [...orderByClauses, asc(schema.EntityInstance.id)]
    : [asc(schema.EntityInstance.id)]

  // limit + 1: the extra row is a probe, never returned — its presence IS `hasMore`.
  const idsQuery = db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(baseWhere)
    .orderBy(...finalOrderBy)
    .limit(limit + 1)
    .offset(offset)

  const countQuery = params.includeTotal
    ? db.select({ count: sql<number>`count(*)::int` }).from(schema.EntityInstance).where(baseWhere)
    : undefined

  const [idsResult, countResult] = await Promise.all([idsQuery, countQuery])

  return {
    ids: idsResult.slice(0, limit).map((r) => r.id),
    ...(countResult ? { total: Number(countResult[0]?.count ?? 0) } : {}),
    hasMore: idsResult.length > limit,
  }
}

/**
 * Count-only variant for entity instances. Skips the id fetch entirely.
 *
 * Takes the same `search` as {@link queryEntityInstanceIdsPaged} so a caller
 * counting "how many rows would this list show" cannot silently count the
 * unsearched set.
 */
export async function countEntityInstances(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  /** Free-text search, ANDed into the WHERE clause exactly as the page query does. */
  search?: string
}): Promise<number> {
  const { db, entityDefinitionId, organizationId, filters } = params

  const { whereClause } = await buildEntityInstanceQueryParts({
    organizationId,
    entityDefinitionId,
    filters,
    sorting: [],
    search: params.search,
  })

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt),
        whereClause
      )
    )

  return Number(result[0]?.count ?? 0)
}

/**
 * System-resource twin of {@link queryEntityInstanceIdsPaged}: `SELECT id ... LIMIT n + 1
 * OFFSET m`, optional parallel `COUNT(*)`, `id ASC` as a deterministic tie-break.
 */
export async function querySystemResourceIdsPaged(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  limit: number
  offset: number
  /** Run the parallel `COUNT(*)`. Callers pay for it on the first page only. */
  includeTotal?: boolean
}): Promise<{ ids: string[]; total?: number; hasMore: boolean }> {
  const { db, tableId, organizationId, filters, sorting, limit, offset } = params

  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new Error(`Unknown table: ${tableId}`)
  }

  const whereClause = buildSystemWhereClause(tableId, organizationId, filters)
  const baseWhere = and(eq(tableSchema.organizationId, organizationId), whereClause)

  const orderByClauses =
    sorting.length > 0
      ? systemConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          tableId
        )
      : undefined

  const finalOrderBy = orderByClauses
    ? [...orderByClauses, asc(tableSchema.id)]
    : [asc(tableSchema.id)]

  // limit + 1: the extra row is a probe, never returned — its presence IS `hasMore`.
  const idsQuery = db
    .select({ id: tableSchema.id })
    .from(tableSchema)
    .where(baseWhere)
    .orderBy(...finalOrderBy)
    .limit(limit + 1)
    .offset(offset)

  const countQuery = params.includeTotal
    ? db.select({ count: sql<number>`count(*)::int` }).from(tableSchema).where(baseWhere)
    : undefined

  const [idsResult, countResult] = await Promise.all([idsQuery, countQuery])

  return {
    ids: idsResult.slice(0, limit).map((r: { id: string }) => r.id),
    ...(countResult ? { total: Number(countResult[0]?.count ?? 0) } : {}),
    hasMore: idsResult.length > limit,
  }
}

/**
 * Count-only variant for system resources. Skips the id fetch entirely.
 */
export async function countSystemResource(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
}): Promise<number> {
  const { db, tableId, organizationId, filters } = params

  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new Error(`Unknown table: ${tableId}`)
  }

  const whereClause = buildSystemWhereClause(tableId, organizationId, filters)

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tableSchema)
    .where(and(eq(tableSchema.organizationId, organizationId), whereClause))

  return Number(result[0]?.count ?? 0)
}

/**
 * System-table twin of the entity WHERE build: same fail-open (a dropped
 * condition widens rather than errors, because stored views must still render)
 * and the same structured warn so the rate is queryable.
 */
function buildSystemWhereClause(
  tableId: TableId,
  organizationId: string,
  filters: ConditionGroup[]
): SQL<unknown> | undefined {
  const built = systemConditionBuilder.buildGroupedQueryWithDiagnostics(filters, tableId)

  if (built.droppedConditions.length > 0) {
    logger.warn('Dropped filter conditions', {
      tableId,
      organizationId,
      droppedCount: built.droppedConditions.length,
      requestedConditions: built.requestedConditions,
      allConditionsDropped: built.allConditionsDropped,
      droppedConditions: built.droppedConditions,
    })
  }

  return built.sql
}

/**
 * Get Drizzle table schema for a system resource
 *
 * @param tableId - System table ID
 */
export function getTableSchema(tableId: TableId) {
  const tableInfo = RESOURCE_TABLE_MAP[tableId]
  if (!tableInfo) return undefined

  // Contact, Ticket, and Part tables have been dropped - they now use EntityInstance.
  const tableMap: Record<string, any> = {
    Inbox: schema.Inbox,
    User: schema.User,
    Thread: schema.Thread,
    Message: schema.Message,
    Participant: schema.Participant,
    Dataset: schema.Dataset,
    Article: schema.Article,
    KnowledgeBase: schema.KnowledgeBase,
  }

  return tableMap[tableInfo.dbName]
}

/**
 * Check if a resource ID is a system resource
 *
 * @param resourceId - Resource ID to check
 */
export function isSystemResource(resourceId: string): boolean {
  return RESOURCE_TABLE_REGISTRY.some((r) => r.id === resourceId)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for listAll query
 */
export interface ListAllInput {
  /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
  entityDefinitionId?: string
  /** API slug like 'tags', 'contacts' */
  apiSlug?: string
  /** Specific field IDs to fetch (all fields if undefined) */
  fieldIds?: FieldId[]
  /**
   * Specific field output keys to fetch (e.g. 'title', 'tag_color'). Ignored
   * when fieldIds is set. Prefer this over fetching all fields — the full
   * fan-out loads every FieldValue for up to 1000 records.
   */
  fieldKeys?: string[]
  /** Include archived records */
  includeArchived?: boolean
}

/**
 * Record with field values
 */
export type ListAllItem = EntityInstanceEntity & {
  recordId: RecordId
  fieldValues: Record<string, unknown>
}

/**
 * Field info for client-side operations
 */
export interface ListAllFieldInfo {
  id: string
  key: string
  type: string
}

/**
 * Result from listAll query
 */
export interface ListAllResult {
  /** Records with field values (inherits displayName, secondaryDisplayValue, avatarUrl from EntityInstanceEntity) */
  items: ListAllItem[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string
  /** Map of field key to field info (for resolving fieldIds when saving) */
  fields: Record<string, ListAllFieldInfo>
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID using org cache.
 *
 * @param organizationId - Organization ID for cache lookup
 * @param params - Must provide either entityDefinitionId or apiSlug
 * @returns Resolved entityDefinitionId UUID
 * @throws Error if neither provided or not found
 */
export async function resolveEntityIdFromCache(
  organizationId: string,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  const key = apiSlug ?? entityDefinitionId
  if (!key) {
    throw new Error('Must provide entityDefinitionId or apiSlug')
  }

  // Try finding as a resource (handles entityType, apiSlug, and UUID)
  const resource = await findCachedResource(organizationId, key)
  if (resource) {
    return resource.entityDefinitionId ?? resource.id
  }

  // If it looks like a UUID/CUID (not a short type name), return as-is
  if (key.length >= 20) {
    return key
  }

  // Try entityDefs cache for entity types
  const resolved = await getCachedEntityDefId(organizationId, key)
  if (resolved) return resolved

  // Try entityDefSlugs cache for apiSlugs
  const slugs = await getOrgCache().get(organizationId, 'entityDefSlugs')
  if (slugs[key]) return slugs[key]

  throw new Error(`Entity not found for key: ${key}`)
}

/**
 * @deprecated Use resolveEntityIdFromCache instead
 */
export async function resolveEntityId(
  registryService: ResourceRegistryService,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  // Resolve from apiSlug if provided
  if (apiSlug) {
    return registryService.resolveEntityDefIdFromApiSlug(apiSlug)
  }

  // Resolve entityDefinitionId (handles 'tag' → UUID, or UUID → UUID)
  if (entityDefinitionId) {
    return registryService.resolveEntityDefId(entityDefinitionId)
  }

  throw new Error('Must provide entityDefinitionId or apiSlug')
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL QUERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all entities with field values for small datasets (no pagination).
 * Resolves entityDefinitionId (can be 'tag', 'contact', or UUID) or apiSlug to actual UUID.
 *
 * @param ctx - Query context
 * @param params - List all parameters
 * @returns Items with field values and resolved entityDefinitionId
 */
export async function listAll(
  ctx: {
    db: Database
    organizationId: string
    userId: string
    /**
     * Request-scoped read enforcement. Absent ⇒ no enforcement (internal/system
     * callers). Added by plan v3/03 §5.4: this ctx had no `capabilities` field at
     * all, so the `FieldValueService` below was constructed unenforced even when
     * the caller had a resolved capability set — dropping relationship redaction
     * from every `listAll` payload.
     */
    capabilities?: CapabilityView
    /**
     * The §5.1 per-record visibility predicate for THIS def. `undefined` = arm 1
     * (see {@link queryEntityInstanceIdsPaged.visibilityWhere}); the caller must
     * not call at all on arm 4.
     */
    visibilityWhere?: SQL
  },
  params: ListAllInput
): Promise<ListAllResult> {
  const { db, organizationId, userId } = ctx

  // Create services
  const fieldValueService = new FieldValueService(organizationId, userId, db, undefined, {
    capabilities: ctx.capabilities,
  })

  // Resolve to actual entityDefinitionId UUID
  const entityDefId = await resolveEntityIdFromCache(organizationId, {
    entityDefinitionId: params.entityDefinitionId,
    apiSlug: params.apiSlug,
  })

  // Fetch all records (safety limit for "all")
  const records = await db.query.EntityInstance.findMany({
    where: (ei, { eq, and, isNull }) => {
      const conditions = [
        eq(ei.entityDefinitionId, entityDefId),
        eq(ei.organizationId, organizationId),
      ]
      if (!params.includeArchived) {
        conditions.push(isNull(ei.archivedAt))
      }
      // Per-record visibility (§5.1) rides the SAME where clause as the rest of
      // the filter, so a grant-only member's `listAll` is one scoped query
      // rather than a full read plus a post-filter.
      if (ctx.visibilityWhere) conditions.push(ctx.visibilityWhere)
      return and(...conditions)
    },
    orderBy: (ei, { desc }) => [desc(ei.updatedAt)],
    limit: 1000,
  })

  // Get all fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefId)

  // Build fields map (outputKey → { id, key, type })
  const fieldsMap: Record<string, ListAllFieldInfo> = {}
  for (const field of fields) {
    const outputKey = getFieldOutputKey(field)
    fieldsMap[outputKey] = {
      id: field.id,
      key: outputKey,
      type: field.fieldType ?? field.type,
    }
  }

  if (records.length === 0) {
    return { items: [], entityDefinitionId: entityDefId, fields: fieldsMap }
  }

  // Build field references and maps from ResourceFieldId → field.key and → fieldType
  const resourceFieldIdToKey = new Map<string, string>()
  const resourceFieldIdToType = new Map<string, FieldType>()
  let fieldReferences: FieldReference[]

  // Resolve fieldKeys (output keys) to field IDs — callers usually know keys, not IDs.
  // Unknown keys are dropped; an all-unknown list yields no field values (not all fields).
  let requestedFieldIds = params.fieldIds
  if ((!requestedFieldIds || requestedFieldIds.length === 0) && params.fieldKeys) {
    requestedFieldIds = params.fieldKeys
      .map((key) => fieldsMap[key]?.id)
      .filter((id): id is string => Boolean(id)) as FieldId[]
  }

  if (requestedFieldIds && (requestedFieldIds.length > 0 || params.fieldKeys)) {
    // Use specific fields provided
    fieldReferences = requestedFieldIds.map((fieldId) => {
      const resourceFieldId = toResourceFieldId(entityDefId, fieldId)
      // Find field by id to get its key and type
      const field = fields.find((f) => f.id === fieldId)
      if (field) {
        resourceFieldIdToKey.set(resourceFieldId, getFieldOutputKey(field))
        resourceFieldIdToType.set(resourceFieldId, (field.fieldType ?? field.type) as FieldType)
      }
      return resourceFieldId as ResourceFieldId
    })
  } else {
    // Use all fields
    fieldReferences = fields
      .filter((f) => f.resourceFieldId) // Only fields with resourceFieldId
      .map((f) => {
        resourceFieldIdToKey.set(f.resourceFieldId as string, getFieldOutputKey(f))
        resourceFieldIdToType.set(f.resourceFieldId as string, (f.fieldType ?? f.type) as FieldType)
        return f.resourceFieldId as ResourceFieldId
      })
  }

  // If no fields, return records without field values
  if (fieldReferences.length === 0) {
    return {
      items: records.map((r) => ({
        ...r,
        recordId: toRecordId(entityDefId, r.id),
        fieldValues: {},
      })),
      entityDefinitionId: entityDefId,
      fields: fieldsMap,
    }
  }

  // Fetch field values for all records
  const recordIds = records.map((r) => toRecordId(entityDefId, r.id))
  const { values } = await fieldValueService.batchGetValues({
    recordIds,
    fieldReferences,
  })

  // Group field values by recordId, using field key (not ResourceFieldId) as the key
  const fieldValuesByRecord = new Map<string, Record<string, unknown>>()
  for (const recordId of recordIds) {
    fieldValuesByRecord.set(recordId, {})
  }

  for (const result of values) {
    const existing = fieldValuesByRecord.get(result.recordId) ?? {}
    // Convert ResourceFieldId to field key for the output
    const resourceFieldId = Array.isArray(result.fieldRef)
      ? result.fieldRef.join('::')
      : result.fieldRef
    const fieldKey = resourceFieldIdToKey.get(resourceFieldId) ?? resourceFieldId
    const fieldType = resourceFieldIdToType.get(resourceFieldId)

    // Extract raw value from TypedFieldValue (e.g., { type: 'text', value: '#C9B6F2' } → '#C9B6F2')
    const rawValue =
      fieldType && result.value != null ? formatToRawValue(result.value, fieldType) : result.value
    existing[fieldKey] = rawValue
    fieldValuesByRecord.set(result.recordId, existing)
  }

  // Merge field values into records
  const items = records.map((record) => {
    const recordId = toRecordId(entityDefId, record.id)
    return {
      ...record,
      recordId,
      fieldValues: fieldValuesByRecord.get(recordId) ?? {},
    }
  })

  return {
    items,
    entityDefinitionId: entityDefId,
    fields: fieldsMap,
  }
}
