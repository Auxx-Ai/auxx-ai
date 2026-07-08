// packages/lib/src/resources/aggregate/system-aggregate-builder.ts
//
// Aggregate SQL for system-table sources (Thread, Message, Article) — same
// skeleton as the entity builder but over direct columns only, with
// `systemConditionBuilder` supplying the WHERE. No EAV joins: v1 rejects
// FieldValue-backed fields (incl. custom fields on system tables) and
// relationship-hop group-bys for system sources.

import { schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import { bucketExpr } from './date-buckets'
import { type FieldSqlPlan, metricExprSql, valueColExpr } from './expressions'
import type { ResolvedDateWindow, ResolvedFieldRef, ResolvedGroupBy, ResolvedMetric } from './types'

/**
 * System tables exposed as dashboard aggregate sources in v1 — a curated
 * allowlist. All have a direct `organizationId` column and registry field
 * metadata. Expand deliberately (org scoping + labels need verifying per
 * table); join-scoped tables (e.g. `user`) are excluded on purpose.
 */
export const SYSTEM_AGGREGATE_TABLE_IDS = ['thread', 'message', 'article'] as const

export type SystemAggregateTableId = (typeof SYSTEM_AGGREGATE_TABLE_IDS)[number]

export function isSystemAggregateTable(tableId: string): tableId is SystemAggregateTableId {
  return (SYSTEM_AGGREGATE_TABLE_IDS as readonly string[]).includes(tableId)
}

/** Drizzle tables for the allowlist (mirrors `getTableSchema`, narrowed to v1 sources). */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous drizzle tables accessed by column name (same idiom as system-table-resolver)
const SYSTEM_AGGREGATE_TABLES: Record<SystemAggregateTableId, any> = {
  thread: schema.Thread,
  message: schema.Message,
  article: schema.Article,
}

export function getSystemAggregateTable(tableId: SystemAggregateTableId) {
  return SYSTEM_AGGREGATE_TABLES[tableId]
}

export type SystemAggregateParams = {
  organizationId: string
  tableId: SystemAggregateTableId
  metric: ResolvedMetric
  groupBy?: ResolvedGroupBy
  secondaryGroupBy?: ResolvedGroupBy
  /** WHERE fragment from `systemConditionBuilder.buildGroupedQuery`. */
  conditionsWhere?: SQL
  dateWindow?: ResolvedDateWindow
  timezone: string
  fetchCap: number
}

/** Build the full aggregate SELECT for a system-table source. */
export function buildSystemAggregateSql(params: SystemAggregateParams): SQL {
  const {
    organizationId,
    tableId,
    metric,
    groupBy,
    secondaryGroupBy,
    conditionsWhere,
    dateWindow,
    timezone,
    fetchCap,
  } = params

  const table = getSystemAggregateTable(tableId)

  function planField(resolved: ResolvedFieldRef): FieldSqlPlan {
    const column = table[resolved.field.dbColumn as string]
    if (!column) {
      // Validation upstream guarantees dbColumn-backed fields; guard anyway.
      throw new Error(`Field '${resolved.field.key}' has no column on system table '${tableId}'`)
    }
    return { kind: 'direct', column: sql`${column}` }
  }

  function groupPieces(g: ResolvedGroupBy): { expr: SQL; rawCol: SQL } {
    const rawCol = valueColExpr(planField(g.field), g.field)
    const expr = g.dateGranularity ? bucketExpr(rawCol, g.dateGranularity, timezone) : rawCol
    return { expr, rawCol }
  }

  const primary = groupBy ? groupPieces(groupBy) : undefined
  const secondary = secondaryGroupBy ? groupPieces(secondaryGroupBy) : undefined

  const idCol = sql`${table.id}`
  const metricPlan = metric.field ? planField(metric.field) : undefined
  const metricSql = metricExprSql(metric, metricPlan, idCol)

  const whereParts: SQL[] = [sql`${table.organizationId} = ${organizationId}`]
  if (conditionsWhere) whereParts.push(conditionsWhere)

  if (dateWindow && (dateWindow.from || dateWindow.to)) {
    const col = valueColExpr(planField(dateWindow.field), dateWindow.field)
    if (dateWindow.from) whereParts.push(sql`${col} >= ${dateWindow.from.toISOString()}`)
    if (dateWindow.to) whereParts.push(sql`${col} < ${dateWindow.to.toISOString()}`)
  }

  if (groupBy?.omitEmpty && primary) whereParts.push(sql`${primary.rawCol} IS NOT NULL`)
  if (secondaryGroupBy?.omitEmpty && secondary)
    whereParts.push(sql`${secondary.rawCol} IS NOT NULL`)

  const selectCols: SQL[] = []
  if (primary) selectCols.push(sql`${primary.expr} AS g`)
  if (secondary) selectCols.push(sql`${secondary.expr} AS g2`)
  selectCols.push(sql`(${metricSql})::float8 AS value`)

  let query = sql`SELECT ${sql.join(selectCols, sql`, `)} FROM ${table}`
  query = sql`${query} WHERE ${sql.join(whereParts, sql` AND `)}`

  if (primary) {
    query = secondary ? sql`${query} GROUP BY 1, 2` : sql`${query} GROUP BY 1`
    const orderBy = groupBy?.dateGranularity ? sql`1 ASC NULLS LAST` : sql`value DESC NULLS LAST`
    query = sql`${query} ORDER BY ${orderBy} LIMIT ${fetchCap + 1}`
  }

  return query
}
