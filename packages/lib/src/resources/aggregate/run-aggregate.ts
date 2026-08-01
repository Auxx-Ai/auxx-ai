// packages/lib/src/resources/aggregate/run-aggregate.ts
//
// Entry point for the aggregate engine. THE resolution boundary: everywhere
// above this module field refs are branded `ResourceFieldId`/`FieldPath`
// strings; this is the single place they get unwrapped (via the resource
// registry) into concrete fields + typed columns. Routes to the entity (EAV)
// or system (direct-column) SQL builder, executes under a statement timeout,
// resolves display labels, and shapes the result.

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  fieldRefToKey,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import { type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getAggregateCache, getCachedResourceFields, PromiseMemoizer } from '../../cache'
import { type ConditionGroup, resolveConditionContext } from '../../conditions'
import {
  DEFAULT_GROUP_LIMIT,
  type GroupBy,
  MAX_GROUP_LIMIT,
  type WidgetFieldRef,
} from '../../dashboards/client'
import { ForbiddenError, UnprocessableEntityError } from '../../errors'
import { BaseType } from '../../workflow-engine/core/types'
import {
  extractRequiredRelatedEntities,
  reportDroppedConditions,
} from '../crud/unified-handler-queries'
import { isMailLensTableId, MAIL_LENS_REFUSAL } from '../picker/mail-lens-tables'
import type { DroppedCondition } from '../query-builder/base-condition-builder'
import { canonicalizeSystemConditions } from '../query-builder/canonicalize-system-fields'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../query-builder/system-condition-builder'
import { isValidTableId, type TableId } from '../registry/field-registry'
import { getFieldOutputKey, type ResourceField } from '../registry/field-types'
import { aggregateCacheKey } from './cache-key'
import { enumerateBuckets, isCyclicGranularity } from './date-buckets'
import { type AggregateRow, buildEntityAggregateSql } from './entity-aggregate-builder'
import { EMPTY_LABEL, resolveGroupLabels } from './group-labels'
import {
  buildSystemAggregateSql,
  isSystemAggregateTable,
  type SystemAggregateTableId,
} from './system-aggregate-builder'
import { deriveTrendWindows } from './trend'
import type {
  AggregateGroup,
  AggregateQuery,
  AggregateResult,
  KpiResult,
  ResolvedFieldRef,
  ResolvedGroupBy,
  ResolvedMetric,
  TrendSpec,
} from './types'

const logger = createScopedLogger('aggregate-engine')

/** Per-widget query guardrail — a pathological widget can't pin a connection. */
const STATEMENT_TIMEOUT = 'SET LOCAL statement_timeout = 5000'
/** Group-row safety caps. Final sort/limit happens in JS after labels resolve. */
const FETCH_CAP_SINGLE = 1000
const FETCH_CAP_MATRIX = 5000
/** Max distinct secondary-series values; overflow buckets into `__other`. */
const MAX_SERIES = 10
export const OTHER_SERIES_KEY = '__other'

/** Skip the cache READ (still writes) — plumbed for the widget refresh button. */
export type AggregateRunOptions = { skipCache?: boolean }

/** In-flight dedup: N concurrent identical queries in one process run 1 compute. */
const aggregateInflight = new PromiseMemoizer<Result<AggregateResult, Error>>()
const kpiInflight = new PromiseMemoizer<Result<KpiResult, Error>>()

const NUMERIC_FIELD_TYPES = new Set<FieldType>(['NUMBER', 'CURRENCY'])
const GRANULARITY_FIELD_TYPES = new Set<FieldType>(['DATE', 'DATETIME'])
const DATE_FAMILY_FIELD_TYPES = new Set<FieldType>(['DATE', 'DATETIME', 'TIME'])
/** No sensible aggregate exists over these (json-shaped / computed / blob-ish). */
const INVALID_METRIC_FIELD_TYPES = new Set<FieldType>(['CALC', 'FILE', 'JSON', 'RICH_TEXT'])
const INVALID_GROUP_FIELD_TYPES = new Set<FieldType>([
  'CALC',
  'FILE',
  'JSON',
  'RICH_TEXT',
  'NAME',
  'ADDRESS_STRUCT',
  'TIME',
])

// ── Field resolution ─────────────────────────────────────────────────────────

/** Effective storage FieldType — `fieldType` when present, else derived from BaseType. */
function fieldTypeFor(field: ResourceField): FieldType {
  if (field.fieldType) return field.fieldType
  switch (field.type) {
    case BaseType.NUMBER:
    case BaseType.CURRENCY:
      return 'NUMBER'
    case BaseType.BOOLEAN:
      return 'CHECKBOX'
    case BaseType.DATE:
      return 'DATE'
    case BaseType.DATETIME:
      return 'DATETIME'
    case BaseType.ENUM:
      return 'SINGLE_SELECT'
    case BaseType.RELATION:
      return 'RELATIONSHIP'
    case BaseType.ACTOR:
      return 'ACTOR'
    default:
      return 'TEXT'
  }
}

/** Same lookup order as the condition builders: id → output key → key → resourceFieldId. */
function findField(fields: ResourceField[], token: string): ResourceField | undefined {
  return (
    fields.find((f) => f.id === token) ??
    fields.find((f) => getFieldOutputKey(f) === token) ??
    fields.find((f) => f.key === token) ??
    fields.find((f) => f.resourceFieldId === token)
  )
}

async function resolveFieldRef(params: {
  organizationId: string
  rootDefId: string
  rootFields: ResourceField[]
  ref: WidgetFieldRef
  /** System sources can't hop (FK relations, not FieldValue) and need dbColumn-backed fields. */
  systemSource: boolean
}): Promise<Result<ResolvedFieldRef, UnprocessableEntityError>> {
  const { organizationId, rootDefId, rootFields, ref, systemSource } = params
  const path = isFieldPath(ref) ? ref : undefined

  if (path && path.length > 2) {
    return err(new UnprocessableEntityError('Field paths deeper than one hop are not supported'))
  }

  const targetRef = path?.[1]
  if (path && targetRef) {
    if (systemSource) {
      return err(
        new UnprocessableEntityError('Relationship paths are not supported for system sources')
      )
    }
    const first = parseResourceFieldId(path[0])
    const hop = findField(rootFields, first.fieldId)
    if (!hop) {
      return err(new UnprocessableEntityError(`Unknown relationship field '${path[0]}'`))
    }
    if (!hop.relationship) {
      return err(
        new UnprocessableEntityError(`Field '${hop.key}' is not a relationship — cannot traverse`)
      )
    }
    const targetDefId = getRelatedEntityDefinitionId(hop.relationship as RelationshipConfig)
    if (!targetDefId) {
      return err(
        new UnprocessableEntityError(`Relationship '${hop.key}' has no resolvable target entity`)
      )
    }
    if (isValidTableId(targetDefId)) {
      return err(
        new UnprocessableEntityError(
          `Relationship '${hop.key}' targets a system resource — hop group-by supports entity targets only`
        )
      )
    }
    const targetFields = await getCachedResourceFields(organizationId, targetDefId)
    const second = parseResourceFieldId(targetRef)
    const field = findField(targetFields, second.fieldId)
    if (!field) {
      return err(new UnprocessableEntityError(`Unknown field '${targetRef}' on '${targetDefId}'`))
    }
    return ok({ ref, hop, field, entityDefinitionId: targetDefId, fieldType: fieldTypeFor(field) })
  }

  const single = path ? path[0] : (ref as ResourceFieldId)
  const parsed = parseResourceFieldId(single)
  const field = findField(rootFields, parsed.fieldId)
  if (!field) {
    return err(new UnprocessableEntityError(`Unknown field '${single}' on '${rootDefId}'`))
  }
  if (systemSource && !field.dbColumn) {
    return err(
      new UnprocessableEntityError(
        `Field '${field.key}' is not column-backed — not aggregatable on system sources yet`
      )
    )
  }
  return ok({ ref, field, entityDefinitionId: rootDefId, fieldType: fieldTypeFor(field) })
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateMetric(metric: ResolvedMetric): UnprocessableEntityError | undefined {
  const { op, field } = metric
  if (op !== 'count' && !field) {
    return new UnprocessableEntityError(`Metric '${op}' requires a field`)
  }
  if (!field) return undefined
  const ft = field.fieldType
  if (INVALID_METRIC_FIELD_TYPES.has(ft)) {
    return new UnprocessableEntityError(`Field type ${ft} cannot be aggregated`)
  }
  if ((op === 'sum' || op === 'avg') && !NUMERIC_FIELD_TYPES.has(ft)) {
    return new UnprocessableEntityError(`'${op}' requires a numeric field (got ${ft})`)
  }
  if (
    (op === 'min' || op === 'max') &&
    !NUMERIC_FIELD_TYPES.has(ft) &&
    !DATE_FAMILY_FIELD_TYPES.has(ft)
  ) {
    return new UnprocessableEntityError(`'${op}' requires a numeric or date field (got ${ft})`)
  }
  if ((op === 'countTrue' || op === 'countFalse') && ft !== 'CHECKBOX') {
    return new UnprocessableEntityError(`'${op}' requires a checkbox field (got ${ft})`)
  }
  return undefined
}

function validateGroupBy(groupBy: ResolvedGroupBy): UnprocessableEntityError | undefined {
  const ft = groupBy.field.fieldType
  if (INVALID_GROUP_FIELD_TYPES.has(ft)) {
    return new UnprocessableEntityError(`Field type ${ft} cannot be grouped by`)
  }
  if (groupBy.dateGranularity && !GRANULARITY_FIELD_TYPES.has(ft)) {
    return new UnprocessableEntityError(`Date granularity requires a date field (got ${ft})`)
  }
  return undefined
}

// ── Preparation (shared by runAggregate + runKpi) ────────────────────────────

type WindowBounds = { from?: Date; to?: Date }

type PreparedAggregate = {
  buildSql: (bounds: WindowBounds | undefined) => SQL
  groupBy?: ResolvedGroupBy
  secondaryGroupBy?: ResolvedGroupBy
  windowField?: ResolvedFieldRef
  windowBounds?: WindowBounds
  fetchCap: number
  timezone: string
  limit: number
  /**
   * Filter conditions that produced no SQL. Returned rather than only logged:
   * a dropped widget filter makes the rendered number too HIGH, and a log line
   * cannot tell the person looking at the chart. Projected onto the result by
   * `computeAggregate` / `computeKpi`.
   */
  dropped: DroppedCondition[]
}

async function prepareAggregate(
  organizationId: string,
  /** Filters already run through `resolveConditionContext` (also the cache-key input). */
  resolvedFilters: ConditionGroup[],
  query: AggregateQuery
): Promise<Result<PreparedAggregate, Error>> {
  const timezone = query.timezone || 'UTC'
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_GROUP_LIMIT, 1), MAX_GROUP_LIMIT)
  const systemSource = query.source.kind === 'system'

  const rootDefId =
    query.source.kind === 'entity' ? query.source.entityDefinitionId : query.source.tableId

  // 🔴 THE mail-content gate for the whole aggregate surface — `runAggregate`
  // and `runKpi` both land here, and this runs before the first read of any
  // kind (no field cache, no DB, no result-cache write). Refused rather than
  // filtered: see the comment on `SYSTEM_AGGREGATE_TABLE_IDS`. Checked for BOTH
  // source kinds, not just `system` — `{kind:'entity', entityDefinitionId:'thread'}`
  // is a shape a client can post, and it must not become a probe either.
  if (isMailLensTableId(rootDefId)) {
    return err(new ForbiddenError(MAIL_LENS_REFUSAL))
  }

  if (systemSource && !isSystemAggregateTable(rootDefId)) {
    return err(
      new UnprocessableEntityError(`System table '${rootDefId}' is not an aggregate source`)
    )
  }

  const rootFields = await getCachedResourceFields(organizationId, rootDefId)
  if (!rootFields || rootFields.length === 0) {
    return err(new UnprocessableEntityError(`Unknown source '${rootDefId}'`))
  }

  const resolveRef = (ref: WidgetFieldRef) =>
    resolveFieldRef({ organizationId, rootDefId, rootFields, ref, systemSource })

  // Metric
  const metric: ResolvedMetric = { op: query.metric.op }
  if (query.metric.fieldRef) {
    const resolved = await resolveRef(query.metric.fieldRef)
    if (resolved.isErr()) return err(resolved.error)
    metric.field = resolved.value
  }
  const metricError = validateMetric(metric)
  if (metricError) return err(metricError)

  // Group-bys
  const resolveGroup = async (
    g: GroupBy | undefined
  ): Promise<Result<ResolvedGroupBy | undefined, Error>> => {
    if (!g) return ok(undefined)
    const resolved = await resolveRef(g.fieldRef)
    if (resolved.isErr()) return err(resolved.error)
    const field = resolved.value
    // Raw-timestamp grouping is never useful — date fields default to day buckets.
    const dateGranularity =
      g.dateGranularity ??
      (GRANULARITY_FIELD_TYPES.has(field.fieldType) ? ('day' as const) : undefined)
    const resolvedGroup: ResolvedGroupBy = {
      field,
      dateGranularity,
      sort: g.sort ?? 'valueDesc',
      limit: Math.min(Math.max(g.limit ?? limit, 1), MAX_GROUP_LIMIT),
      omitEmpty: g.omitEmpty ?? false,
    }
    const groupError = validateGroupBy(resolvedGroup)
    if (groupError) return err(groupError)
    return ok(resolvedGroup)
  }

  const groupByResult = await resolveGroup(query.groupBy)
  if (groupByResult.isErr()) return err(groupByResult.error)
  const groupBy = groupByResult.value

  const secondaryResult = await resolveGroup(query.secondaryGroupBy)
  if (secondaryResult.isErr()) return err(secondaryResult.error)
  const secondaryGroupBy = groupBy ? secondaryResult.value : undefined

  // Date window
  let windowField: ResolvedFieldRef | undefined
  let windowBounds: WindowBounds | undefined
  if (query.dateWindow && (query.dateWindow.from || query.dateWindow.to)) {
    const resolved = await resolveRef(query.dateWindow.fieldRef)
    if (resolved.isErr()) return err(resolved.error)
    if (!DATE_FAMILY_FIELD_TYPES.has(resolved.value.fieldType)) {
      return err(new UnprocessableEntityError('Date window must bind to a date field'))
    }
    windowField = resolved.value
    windowBounds = { from: query.dateWindow.from, to: query.dateWindow.to }
  }

  // Filters → WHERE fragment
  const filters = resolvedFilters

  let conditionsWhere: SQL | undefined
  let dropped: DroppedCondition[] = []
  if (query.source.kind === 'entity') {
    const relatedEntityFields: Record<string, ResourceField[]> = {}
    for (const relatedDefId of extractRequiredRelatedEntities(filters, rootFields)) {
      relatedEntityFields[relatedDefId] = await getCachedResourceFields(
        organizationId,
        relatedDefId
      )
    }
    const context: EntityQueryContext = {
      fields: rootFields,
      outerTable: schema.EntityInstance,
      relatedEntityFields,
    }
    const built = entityConditionBuilder.buildGroupedQueryWithDiagnostics(filters, context)
    conditionsWhere = built.sql
    dropped = built.droppedConditions
    if (built.droppedConditions.length > 0) {
      // Structured so "how often is a widget filter silently ignored" is a query.
      // A widget deliberately still renders (wider) rather than erroring.
      logger.warn('Dropped widget filter conditions', {
        organizationId,
        entityDefinitionId: rootDefId,
        droppedCount: built.droppedConditions.length,
        requestedConditions: built.requestedConditions,
        allConditionsDropped: built.allConditionsDropped,
        droppedConditions: built.droppedConditions,
      })
    }
  } else if (filters.length) {
    // The filter surfaces address a field on a system resource by the org's
    // merged `CustomField` cuid, while `SystemConditionBuilder` resolves against
    // `RESOURCE_FIELD_REGISTRY[tableId]`, which is keyed by the STATIC key. Left
    // untranslated every such condition dropped — and on an aggregate a dropped
    // filter does not narrow, so the widget reported a number that was too HIGH.
    //
    // `rootFields` is the merged field set for exactly this resource, already
    // loaded above, so this adds no I/O; the call is pure and idempotent (stored
    // widgets hold either shape). Unresolvable refs come back unchanged on
    // purpose, so they still land in `droppedConditions` below rather than being
    // compiled into a confidently wrong lookup.
    const canonicalFilters = canonicalizeSystemConditions(filters, rootDefId as TableId, rootFields)
    const built = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      canonicalFilters,
      rootDefId as TableId
    )
    conditionsWhere = built.sql
    dropped = built.droppedConditions
    if (built.droppedConditions.length > 0) {
      // Same shape as the entity branch above — a dropped widget filter makes a
      // KPI/chart number too HIGH, so "how often is a widget filter silently
      // ignored" has to be answerable from the logs rather than from a user
      // noticing. The widget still renders (wider) rather than erroring.
      logger.warn('Dropped widget filter conditions', {
        organizationId,
        entityDefinitionId: rootDefId,
        droppedCount: built.droppedConditions.length,
        requestedConditions: built.requestedConditions,
        allConditionsDropped: built.allConditionsDropped,
        droppedConditions: built.droppedConditions,
      })
    }
  }

  const fetchCap = secondaryGroupBy ? FETCH_CAP_MATRIX : FETCH_CAP_SINGLE

  const buildSql = (bounds: WindowBounds | undefined): SQL => {
    const dateWindow =
      windowField && bounds && (bounds.from || bounds.to)
        ? { field: windowField, from: bounds.from, to: bounds.to }
        : undefined
    if (query.source.kind === 'entity') {
      return buildEntityAggregateSql({
        organizationId,
        entityDefinitionId: rootDefId,
        metric,
        groupBy,
        secondaryGroupBy,
        conditionsWhere,
        dateWindow,
        timezone,
        fetchCap,
      })
    }
    return buildSystemAggregateSql({
      organizationId,
      tableId: rootDefId as SystemAggregateTableId,
      metric,
      groupBy,
      secondaryGroupBy,
      conditionsWhere,
      dateWindow,
      timezone,
      fetchCap,
    })
  }

  return ok({
    buildSql,
    groupBy,
    secondaryGroupBy,
    windowField,
    windowBounds,
    fetchCap,
    timezone,
    limit: groupBy?.limit ?? limit,
    dropped,
  })
}

// ── Execution + shaping ──────────────────────────────────────────────────────

async function executeAggregate(db: Database, query: SQL): Promise<AggregateRow[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(STATEMENT_TIMEOUT))
    const result = await tx.execute(query)
    return (result as unknown as { rows: AggregateRow[] }).rows ?? []
  })
}

function normalizeKey(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

type ShapedGroup = { key: string | null; value: number; series?: Map<string | null, number> }

/** Collapse (g, g2, value) rows into primary groups with a series map. */
function shapeRows(
  rows: AggregateRow[],
  hasSecondary: boolean
): { groups: ShapedGroup[]; seriesTotals: Map<string | null, number> } {
  const seriesTotals = new Map<string | null, number>()
  if (!hasSecondary) {
    return {
      groups: rows.map((r) => ({ key: normalizeKey(r.g), value: toNumber(r.value) })),
      seriesTotals,
    }
  }

  const byPrimary = new Map<string | null, ShapedGroup>()
  for (const row of rows) {
    const key = normalizeKey(row.g)
    const seriesKey = normalizeKey(row.g2)
    const value = toNumber(row.value)
    let group = byPrimary.get(key)
    if (!group) {
      group = { key, value: 0, series: new Map() }
      byPrimary.set(key, group)
    }
    group.value += value
    group.series?.set(seriesKey, (group.series.get(seriesKey) ?? 0) + value)
    seriesTotals.set(seriesKey, (seriesTotals.get(seriesKey) ?? 0) + value)
  }
  return { groups: [...byPrimary.values()], seriesTotals }
}

/** Numeric-aware key/label comparison; `null` (empty bucket) always sorts last. */
function compareByLabel(
  a: { key: string | null; label: string },
  b: { key: string | null; label: string },
  byKey: boolean
): number {
  if (a.key === null) return 1
  if (b.key === null) return -1
  const av = byKey ? a.key : a.label
  const bv = byKey ? b.key : b.label
  const an = Number(av)
  const bn = Number(bv)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  return av.localeCompare(bv)
}

function sortGroups(groups: AggregateGroup[], groupBy: ResolvedGroupBy): AggregateGroup[] {
  const isDateBucket = Boolean(groupBy.dateGranularity)
  const sorted = [...groups]
  switch (groupBy.sort) {
    case 'labelAsc':
      sorted.sort((a, b) => compareByLabel(a, b, isDateBucket))
      break
    case 'labelDesc':
      sorted.sort((a, b) => compareByLabel(b, a, isDateBucket))
      break
    case 'valueAsc':
      sorted.sort((a, b) => a.value - b.value || compareByLabel(a, b, isDateBucket))
      break
    default:
      sorted.sort((a, b) => b.value - a.value || compareByLabel(a, b, isDateBucket))
  }
  return sorted
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The source id a query names, whichever kind it is. Both kinds are checked for
 * mail content — see the gate in `prepareAggregate`.
 */
function sourceIdOf(query: AggregateQuery): string {
  return query.source.kind === 'entity' ? query.source.entityDefinitionId : query.source.tableId
}

/**
 * Refuse mail-content sources at the OUTERMOST edge, ahead of the aggregate
 * result cache.
 *
 * `prepareAggregate` holds the same gate, but it runs *after* the cache read —
 * and the cache was populated by the same query shape before this refusal
 * existed, so a gate below the read would keep serving a warm thread aggregate
 * until its TTL expired. Nothing here touches Redis or the DB.
 */
function refuseMailLensSource(query: AggregateQuery): ForbiddenError | undefined {
  return isMailLensTableId(sourceIdOf(query)) ? new ForbiddenError(MAIL_LENS_REFUSAL) : undefined
}

/**
 * Run a grouped aggregate query. Group keys stay RAW (drill-down rebuilds
 * segment conditions from them); labels are display-only. Without a `groupBy`
 * the result carries the single value in `totalValue` with no groups.
 *
 * Results are cached for a short TTL keyed on the RESOLVED query (viewer
 * placeholders substituted, timezone included) — safe to share across users
 * because aggregates carry no row-level permissions. Errors are never cached;
 * `opts.skipCache` bypasses the read but still writes (refresh = repopulate).
 */
export async function runAggregate(
  db: Database,
  organizationId: string,
  userId: string | undefined,
  query: AggregateQuery,
  opts?: AggregateRunOptions
): Promise<Result<AggregateResult, Error>> {
  const refusal = refuseMailLensSource(query)
  if (refusal) return err(refusal)

  try {
    const resolvedFilters = resolveConditionContext(query.filters ?? [], {
      currentUserId: userId,
    })
    const cacheKey = aggregateCacheKey({
      kind: 'agg',
      organizationId,
      query: { ...query, filters: resolvedFilters },
    })

    return await aggregateInflight.memoize(cacheKey, async () => {
      if (!opts?.skipCache) {
        const hit = await getAggregateCache().read<AggregateResult>(cacheKey)
        if (hit) {
          logger.debug(`chart aggregate cache hit [${cacheKey}]`)
          return ok(hit.result)
        }
      }
      const result = await computeAggregate(db, organizationId, resolvedFilters, query)
      if (result.isOk()) {
        await getAggregateCache().write(cacheKey, result.value)
      }
      return result
    })
  } catch (error) {
    logger.error(`runAggregate failed: ${error instanceof Error ? error.message : error}`)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

async function computeAggregate(
  db: Database,
  organizationId: string,
  resolvedFilters: ConditionGroup[],
  query: AggregateQuery
): Promise<Result<AggregateResult, Error>> {
  const prepared = await prepareAggregate(organizationId, resolvedFilters, query)
  if (prepared.isErr()) return err(prepared.error)
  const {
    buildSql,
    groupBy,
    secondaryGroupBy,
    windowField,
    windowBounds,
    fetchCap,
    timezone,
    limit,
    dropped,
  } = prepared.value

  // Every value below describes a set the widget's filters did NOT narrow as
  // asked when this is non-empty. Reported, not thrown — the widget still
  // renders, as it did before.
  const droppedReport = reportDroppedConditions(dropped)

  const rows = await executeAggregate(db, buildSql(windowBounds))

  if (!groupBy) {
    const value = toNumber(rows[0]?.value)
    return ok({ groups: [], totalValue: value, hasMoreGroups: false, ...droppedReport })
  }

  const overflow = rows.length > fetchCap
  const { groups: shaped, seriesTotals } = shapeRows(
    overflow ? rows.slice(0, fetchCap) : rows,
    Boolean(secondaryGroupBy)
  )

  // Zero-fill date buckets: cyclic granularities always fill their key space;
  // calendar buckets fill only when the window is bounded AND bound to the
  // same field we group by (otherwise the axis range is unknowable).
  if (groupBy.dateGranularity) {
    const sameField =
      windowField && fieldRefToKey(windowField.ref) === fieldRefToKey(groupBy.field.ref)
    const bounded = Boolean(windowBounds?.from && windowBounds?.to)
    let fillKeys: string[] | undefined
    if (isCyclicGranularity(groupBy.dateGranularity)) {
      fillKeys = enumerateBuckets(new Date(0), new Date(0), groupBy.dateGranularity, timezone)
    } else if (sameField && bounded && windowBounds?.from && windowBounds.to) {
      fillKeys = enumerateBuckets(
        windowBounds.from,
        windowBounds.to,
        groupBy.dateGranularity,
        timezone
      )
    }
    if (fillKeys) {
      const present = new Set(shaped.map((g) => g.key))
      for (const key of fillKeys) {
        if (!present.has(key)) shaped.push({ key, value: 0 })
      }
    }
  }

  // Labels (batched per dimension)
  const primaryLabels = await resolveGroupLabels({
    db,
    organizationId,
    groupBy,
    keys: shaped.map((g) => g.key),
  })
  let seriesLabels: Map<string | null, string> | undefined
  let rankedSeriesKeys: Array<string | null> | undefined
  if (secondaryGroupBy) {
    // Global series ranking → top N keys keep their identity, the rest fold
    // into a single `__other` series so stacked charts stay readable.
    const ranked = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    rankedSeriesKeys = ranked.slice(0, MAX_SERIES)
    seriesLabels = await resolveGroupLabels({
      db,
      organizationId,
      groupBy: secondaryGroupBy,
      keys: rankedSeriesKeys,
    })
  }

  const labeled: AggregateGroup[] = shaped.map((g) => {
    const group: AggregateGroup = {
      key: g.key,
      label: primaryLabels.get(g.key) ?? g.key ?? EMPTY_LABEL,
      value: g.value,
    }
    if (secondaryGroupBy && rankedSeriesKeys && seriesLabels) {
      const kept = new Map<string | null, number>()
      let otherTotal = 0
      for (const [seriesKey, value] of g.series ?? []) {
        if (rankedSeriesKeys.includes(seriesKey)) {
          kept.set(seriesKey, value)
        } else {
          otherTotal += value
        }
      }
      group.series = rankedSeriesKeys
        .filter((k) => kept.has(k))
        .map((k) => ({
          key: k,
          label: seriesLabels?.get(k) ?? k ?? EMPTY_LABEL,
          value: kept.get(k) ?? 0,
        }))
      if (otherTotal > 0) {
        group.series.push({ key: OTHER_SERIES_KEY, label: 'Other', value: otherTotal })
      }
    }
    return group
  })

  const sorted = sortGroups(labeled, groupBy)
  const totalValue = sorted.reduce((sum, g) => sum + g.value, 0)
  const hasMoreGroups = overflow || sorted.length > limit

  return ok({ groups: sorted.slice(0, limit), totalValue, hasMoreGroups, ...droppedReport })
}

/**
 * Run a single-value aggregate (KPI/gauge), optionally with a trend comparison.
 * Trend requires a BOUNDED window — when the resolved window is unbounded the
 * previous-window query is skipped and `previousValue` stays undefined (the UI
 * hides the trend). No fallback window is invented. Cached like `runAggregate`
 * (trend compare is part of the key).
 */
export async function runKpi(
  db: Database,
  organizationId: string,
  userId: string | undefined,
  params: { base: AggregateQuery; trend?: TrendSpec },
  opts?: AggregateRunOptions
): Promise<Result<KpiResult, Error>> {
  const refusal = refuseMailLensSource(params.base)
  if (refusal) return err(refusal)

  try {
    const base: AggregateQuery = { ...params.base, groupBy: undefined, secondaryGroupBy: undefined }
    const resolvedFilters = resolveConditionContext(base.filters ?? [], {
      currentUserId: userId,
    })
    const cacheKey = aggregateCacheKey({
      kind: 'kpi',
      organizationId,
      query: { ...base, filters: resolvedFilters },
      compare: params.trend?.compare ?? null,
    })

    return await kpiInflight.memoize(cacheKey, async () => {
      if (!opts?.skipCache) {
        const hit = await getAggregateCache().read<KpiResult>(cacheKey)
        if (hit) {
          logger.debug(`kpi aggregate cache hit [${cacheKey}]`)
          return ok(hit.result)
        }
      }
      const result = await computeKpi(db, organizationId, resolvedFilters, base, params.trend)
      if (result.isOk()) {
        await getAggregateCache().write(cacheKey, result.value)
      }
      return result
    })
  } catch (error) {
    logger.error(`runKpi failed: ${error instanceof Error ? error.message : error}`)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

async function computeKpi(
  db: Database,
  organizationId: string,
  resolvedFilters: ConditionGroup[],
  base: AggregateQuery,
  trend: TrendSpec | undefined
): Promise<Result<KpiResult, Error>> {
  const prepared = await prepareAggregate(organizationId, resolvedFilters, base)
  if (prepared.isErr()) return err(prepared.error)
  const { buildSql, windowBounds, timezone, dropped } = prepared.value

  // A KPI is the worst case for a silently dropped filter: one big number, no
  // rows to eyeball, and a trend arrow computed from the same widened set.
  const droppedReport = reportDroppedConditions(dropped)

  const trendWindows = trend
    ? deriveTrendWindows(windowBounds ?? {}, trend.compare, timezone)
    : undefined

  if (!trendWindows) {
    const rows = await executeAggregate(db, buildSql(windowBounds))
    return ok({ value: toNumber(rows[0]?.value), ...droppedReport })
  }

  const [currentRows, previousRows] = await Promise.all([
    executeAggregate(db, buildSql(trendWindows.current)),
    executeAggregate(db, buildSql(trendWindows.previous)),
  ])
  return ok({
    value: toNumber(currentRows[0]?.value),
    previousValue: toNumber(previousRows[0]?.value),
    ...droppedReport,
  })
}
