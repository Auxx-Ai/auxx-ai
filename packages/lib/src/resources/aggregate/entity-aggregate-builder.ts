// packages/lib/src/resources/aggregate/entity-aggregate-builder.ts
//
// EAV aggregate SQL over EntityInstance + FieldValue. One SELECT with LEFT
// JOINs to FieldValue per referenced field (deduped by field ref), built from
// Drizzle `sql` fragments — parameterized values, identifiers only from our own
// registry-resolved metadata (never user input).
//
// Multi-value caveat (by design): grouping by MULTI_SELECT/TAGS counts a record
// once per value it has; `sum` over a multi-value NUMBER field sums every row;
// `avg` is row-level. `count` is COUNT(DISTINCT EntityInstance.id) so group
// fan-out never inflates record counts.

import { schema } from '@auxx/database'
import { fieldRefToKey } from '@auxx/types/field'
import { type SQL, sql } from 'drizzle-orm'
import { bucketExpr } from './date-buckets'
import { type FieldSqlPlan, metricExprSql, valueColExpr } from './expressions'
import type { ResolvedDateWindow, ResolvedFieldRef, ResolvedGroupBy, ResolvedMetric } from './types'

export type EntityAggregateParams = {
  organizationId: string
  entityDefinitionId: string
  metric: ResolvedMetric
  groupBy?: ResolvedGroupBy
  secondaryGroupBy?: ResolvedGroupBy
  /** WHERE fragment from `entityConditionBuilder.buildGroupedQuery` (already context-resolved). */
  conditionsWhere?: SQL
  dateWindow?: ResolvedDateWindow
  timezone: string
  /** Safety cap on fetched group rows; the query fetches `fetchCap + 1` to detect overflow. */
  fetchCap: number
}

/** Row shape produced by the aggregate SELECT. */
export type AggregateRow = { g?: unknown; g2?: unknown; value: number | string | null }

/** True when the field maps to a real column on EntityInstance (no FieldValue join). */
export function isEntityInstanceColumn(field: ResolvedFieldRef): boolean {
  if (field.hop) return false
  const { dbColumn, isSystem } = field.field
  if (!isSystem || !dbColumn) return false
  return Boolean((schema.EntityInstance as unknown as Record<string, unknown>)[dbColumn])
}

/** Build the full aggregate SELECT for an entity-def source. */
export function buildEntityAggregateSql(params: EntityAggregateParams): SQL {
  const {
    organizationId,
    entityDefinitionId,
    metric,
    groupBy,
    secondaryGroupBy,
    conditionsWhere,
    dateWindow,
    timezone,
    fetchCap,
  } = params

  // ── Join planning (deduped by field ref) ──────────────────────────────────
  const joins: SQL[] = []
  const planByKey = new Map<string, FieldSqlPlan>()
  const hopAliasByFieldId = new Map<string, string>()
  let aliasSeq = 0

  const entityIdCol = schema.EntityInstance.id

  function planField(resolved: ResolvedFieldRef): FieldSqlPlan {
    const key = fieldRefToKey(resolved.ref)
    const existing = planByKey.get(key)
    if (existing) return existing

    if (isEntityInstanceColumn(resolved)) {
      const column = (schema.EntityInstance as unknown as Record<string, SQL>)[
        resolved.field.dbColumn as string
      ]
      const plan: FieldSqlPlan = { kind: 'direct', column: sql`${column}` }
      planByKey.set(key, plan)
      return plan
    }

    // Anchor for the value join: EntityInstance.id, or the hop row's target id.
    let anchor: SQL = sql`${entityIdCol}`
    if (resolved.hop) {
      let relAlias = hopAliasByFieldId.get(resolved.hop.id)
      if (!relAlias) {
        relAlias = `fvr_${aliasSeq++}`
        hopAliasByFieldId.set(resolved.hop.id, relAlias)
        const r = sql.raw(`"${relAlias}"`)
        joins.push(
          sql`LEFT JOIN "FieldValue" ${r} ON ${r}."entityId" = ${entityIdCol} AND ${r}."fieldId" = ${resolved.hop.id}`
        )
      }
      anchor = sql`${sql.raw(`"${relAlias}"`)}."relatedEntityId"`
    }

    const alias = `fv_${aliasSeq++}`
    const a = sql.raw(`"${alias}"`)
    joins.push(
      sql`LEFT JOIN "FieldValue" ${a} ON ${a}."entityId" = ${anchor} AND ${a}."fieldId" = ${resolved.field.id}`
    )
    const plan: FieldSqlPlan = { kind: 'fv', alias }
    planByKey.set(key, plan)
    return plan
  }

  // ── Group expressions ─────────────────────────────────────────────────────
  function groupPieces(g: ResolvedGroupBy): { expr: SQL; rawCol: SQL } {
    const plan = planField(g.field)
    const rawCol = valueColExpr(plan, g.field)
    const expr = g.dateGranularity ? bucketExpr(rawCol, g.dateGranularity, timezone) : rawCol
    return { expr, rawCol }
  }

  const primary = groupBy ? groupPieces(groupBy) : undefined
  const secondary = secondaryGroupBy ? groupPieces(secondaryGroupBy) : undefined

  // ── Metric expression ─────────────────────────────────────────────────────
  const metricPlan = metric.field ? planField(metric.field) : undefined
  const metricSql = metricExprSql(metric, metricPlan, sql`${entityIdCol}`)

  // ── WHERE ─────────────────────────────────────────────────────────────────
  const whereParts: SQL[] = [
    sql`${schema.EntityInstance.organizationId} = ${organizationId}`,
    sql`${schema.EntityInstance.entityDefinitionId} = ${entityDefinitionId}`,
    sql`${schema.EntityInstance.archivedAt} IS NULL`,
  ]
  if (conditionsWhere) whereParts.push(conditionsWhere)

  if (dateWindow && (dateWindow.from || dateWindow.to)) {
    const plan = planField(dateWindow.field)
    const col = valueColExpr(plan, dateWindow.field)
    if (dateWindow.from) whereParts.push(sql`${col} >= ${dateWindow.from.toISOString()}`)
    if (dateWindow.to) whereParts.push(sql`${col} < ${dateWindow.to.toISOString()}`)
  }

  if (groupBy?.omitEmpty && primary) whereParts.push(sql`${primary.rawCol} IS NOT NULL`)
  if (secondaryGroupBy?.omitEmpty && secondary)
    whereParts.push(sql`${secondary.rawCol} IS NOT NULL`)

  // ── Assembly ──────────────────────────────────────────────────────────────
  const selectCols: SQL[] = []
  if (primary) selectCols.push(sql`${primary.expr} AS g`)
  if (secondary) selectCols.push(sql`${secondary.expr} AS g2`)
  selectCols.push(sql`(${metricSql})::float8 AS value`)

  let query = sql`SELECT ${sql.join(selectCols, sql`, `)} FROM ${schema.EntityInstance}`
  for (const join of joins) {
    query = sql`${query} ${join}`
  }
  query = sql`${query} WHERE ${sql.join(whereParts, sql` AND `)}`

  if (primary) {
    query = secondary ? sql`${query} GROUP BY 1, 2` : sql`${query} GROUP BY 1`
    // Deterministic fetch order under the cap: date buckets keep chronology,
    // everything else keeps the biggest groups. Final sort happens in JS after
    // label resolution (label sorts need labels).
    const orderBy = groupBy?.dateGranularity ? sql`1 ASC NULLS LAST` : sql`value DESC NULLS LAST`
    query = sql`${query} ORDER BY ${orderBy} LIMIT ${fetchCap + 1}`
  }

  return query
}
