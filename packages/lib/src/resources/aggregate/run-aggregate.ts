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
import { getCachedResourceFields } from '../../cache'
import { type ConditionGroup, resolveConditionContext } from '../../conditions'
import {
  DEFAULT_GROUP_LIMIT,
  type GroupBy,
  MAX_GROUP_LIMIT,
  type WidgetFieldRef,
} from '../../dashboards/client'
import { UnprocessableEntityError } from '../../errors'
import { BaseType } from '../../workflow-engine/core/types'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../../workflow-engine/query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../../workflow-engine/query-builder/system-condition-builder'
import { extractRequiredRelatedEntities } from '../crud/unified-handler-queries'
import { isValidTableId, type TableId } from '../registry/field-registry'
import { getFieldOutputKey, type ResourceField } from '../registry/field-types'
import { enumerateBuckets, isCyclicGranularity } from './date-buckets'
import { type AggregateRow, buildEntityAggregateSql } from './entity-aggregate-builder'
import { EMPTY_LABEL, resolveGroupLabels } from './group-labels'
import { buildSystemAggregateSql, isSystemAggregateTable } from './system-aggregate-builder'
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
}

async function prepareAggregate(
  organizationId: string,
  userId: string | undefined,
  query: AggregateQuery
): Promise<Result<PreparedAggregate, Error>> {
  const timezone = query.timezone || 'UTC'
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_GROUP_LIMIT, 1), MAX_GROUP_LIMIT)
  const systemSource = query.source.kind === 'system'

  const rootDefId =
    query.source.kind === 'entity' ? query.source.entityDefinitionId : query.source.tableId

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
  const filters: ConditionGroup[] = resolveConditionContext(query.filters ?? [], {
    currentUserId: userId,
  })

  let conditionsWhere: SQL | undefined
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
    conditionsWhere = filters.length
      ? entityConditionBuilder.buildGroupedQuery(filters, context)
      : undefined
    if (entityConditionBuilder.droppedConditions.length > 0) {
      logger.warn(
        `Dropped ${entityConditionBuilder.droppedConditions.length} widget filter condition(s)`
      )
    }
  } else {
    conditionsWhere = filters.length
      ? systemConditionBuilder.buildGroupedQuery(filters, rootDefId as TableId)
      : undefined
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
      tableId: rootDefId as 'thread' | 'message' | 'article',
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
 * Run a grouped aggregate query. Group keys stay RAW (drill-down rebuilds
 * segment conditions from them); labels are display-only. Without a `groupBy`
 * the result carries the single value in `totalValue` with no groups.
 */
export async function runAggregate(
  db: Database,
  organizationId: string,
  userId: string | undefined,
  query: AggregateQuery
): Promise<Result<AggregateResult, Error>> {
  try {
    const prepared = await prepareAggregate(organizationId, userId, query)
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
    } = prepared.value

    const rows = await executeAggregate(db, buildSql(windowBounds))

    if (!groupBy) {
      const value = toNumber(rows[0]?.value)
      return ok({ groups: [], totalValue: value, hasMoreGroups: false })
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

    return ok({ groups: sorted.slice(0, limit), totalValue, hasMoreGroups })
  } catch (error) {
    logger.error(`runAggregate failed: ${error instanceof Error ? error.message : error}`)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Run a single-value aggregate (KPI/gauge), optionally with a trend comparison.
 * Trend requires a BOUNDED window — when the resolved window is unbounded the
 * previous-window query is skipped and `previousValue` stays undefined (the UI
 * hides the trend). No fallback window is invented.
 */
export async function runKpi(
  db: Database,
  organizationId: string,
  userId: string | undefined,
  params: { base: AggregateQuery; trend?: TrendSpec }
): Promise<Result<KpiResult, Error>> {
  try {
    const base: AggregateQuery = { ...params.base, groupBy: undefined, secondaryGroupBy: undefined }
    const prepared = await prepareAggregate(organizationId, userId, base)
    if (prepared.isErr()) return err(prepared.error)
    const { buildSql, windowBounds, timezone } = prepared.value

    const trendWindows = params.trend
      ? deriveTrendWindows(windowBounds ?? {}, params.trend.compare, timezone)
      : undefined

    if (!trendWindows) {
      const rows = await executeAggregate(db, buildSql(windowBounds))
      return ok({ value: toNumber(rows[0]?.value) })
    }

    const [currentRows, previousRows] = await Promise.all([
      executeAggregate(db, buildSql(trendWindows.current)),
      executeAggregate(db, buildSql(trendWindows.previous)),
    ])
    return ok({
      value: toNumber(currentRows[0]?.value),
      previousValue: toNumber(previousRows[0]?.value),
    })
  } catch (error) {
    logger.error(`runKpi failed: ${error instanceof Error ? error.message : error}`)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
