// packages/lib/src/resources/aggregate/system-aggregate-builder.ts
//
// Aggregate SQL for system-table sources (Thread, Message, Article) — same
// skeleton as the entity builder but over direct columns only, with
// `systemConditionBuilder` supplying the WHERE. No EAV joins: v1 rejects
// FieldValue-backed fields (incl. custom fields on system tables) and
// relationship-hop group-bys for system sources.

import { schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import { ForbiddenError } from '../../errors'
import { isMailLensTableId, MAIL_LENS_REFUSAL } from '../picker/mail-lens-tables'
import { bucketExpr } from './date-buckets'
import { type FieldSqlPlan, metricExprSql, valueColExpr } from './expressions'
import type { ResolvedDateWindow, ResolvedFieldRef, ResolvedGroupBy, ResolvedMetric } from './types'

/**
 * System tables exposed as dashboard aggregate sources — a curated allowlist.
 * All have a direct `organizationId` column and registry field metadata. Expand
 * deliberately (org scoping + labels need verifying per table); join-scoped
 * tables (e.g. `user`) are excluded on purpose.
 *
 * 🔴 **`thread` and `message` were here and are gone.** The WHERE this builder
 * emits is `organizationId = $1` and nothing else — no
 * `buildMailVisibilityPredicate`, no `isNull(mergedIntoThreadId)` — so a chart
 * over `thread` aggregated the ENTIRE organization's mailbox for anyone who
 * could open the dashboard. `groupBy: assignee` was a per-person volume
 * disclosure and a high-cardinality group-by leaked content outright: the group
 * LABELS are the raw column values, so grouping by `subject` printed subject
 * lines.
 *
 * Adding the row predicate would not have fixed it. The predicate admits rows at
 * the `metadata` tier while reading a subject needs `identity`
 * (`permissions/visibility/lens.ts`), and it is per-VIEWER while the aggregate
 * result cache is keyed without a user (`runAggregate` documents results as
 * "safe to share across users because aggregates carry no row-level
 * permissions") — a per-viewer predicate would poison that cache for everyone
 * else. Refusing is the same call the list path made in
 * `crud/unified-handler-queries.ts` (`assertNotMailLensTable`) and the picker
 * made in `picker/record-picker-service.ts`; the mail lens in `mail-query/` is
 * the only path to thread content. A `COUNT(*)` over the org's mailbox is still
 * a disclosure, so counts and group-bys are refused exactly like row lists.
 *
 * Decision recorded 2026-07-31, `plans/search/2026-07-31-retrieval-execution-sequence.md`
 * step 0.1.
 */
export const SYSTEM_AGGREGATE_TABLE_IDS = ['article'] as const

export type SystemAggregateTableId = (typeof SYSTEM_AGGREGATE_TABLE_IDS)[number]

export function isSystemAggregateTable(tableId: string): tableId is SystemAggregateTableId {
  return (SYSTEM_AGGREGATE_TABLE_IDS as readonly string[]).includes(tableId)
}

/** Drizzle tables for the allowlist (mirrors `getTableSchema`, narrowed to v1 sources). */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous drizzle tables accessed by column name (same idiom as system-table-resolver)
const SYSTEM_AGGREGATE_TABLES: Record<SystemAggregateTableId, any> = {
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

/**
 * Build the full aggregate SELECT for a system-table source.
 *
 * Throws `ForbiddenError` for `thread` / `message`. `prepareAggregate` already
 * refuses them, so this is the last line before Postgres rather than the gate —
 * callers reach this function through a `tableId` cast, and the WHERE built
 * below carries no mail lens (see {@link SYSTEM_AGGREGATE_TABLE_IDS}).
 */
export function buildSystemAggregateSql(params: SystemAggregateParams): SQL {
  if (isMailLensTableId(params.tableId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)

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
