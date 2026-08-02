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
import { articleVisibilitySql } from '../../permissions/capabilities/article-visibility-scope'
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
 *
 * ⚠ **`article` — the one entry left — DOES carry a per-row policy**, and the
 * paragraph above did not know it (plan v3/06 §3.1 R9). An article inherits its
 * knowledge base's instance grants, so `organizationId = $1` alone counted
 * articles in KBs the viewer cannot open. It is **filtered**, not refused, and
 * the `thread`/`message` argument deliberately does not transfer (§5.6, §11
 * item 2 — closed in favour of the cache key):
 *
 * - The scope is a short **bounded id list** (`viewableKnowledgeBaseIds`), not a
 *   per-viewer row predicate over an unbounded table, and it is resolved from
 *   one org-cache read.
 * - There is no tier problem. Mail admits a row at `metadata` while its subject
 *   needs `identity`, so a group-by leaks labels the predicate never authorized;
 *   an article row is either in a viewable KB or it is not, and its group labels
 *   are columns of rows that survived the predicate.
 * - The user-agnostic result cache is preserved by **forking the key** on
 *   {@link import('../../permissions/capabilities/article-visibility-scope').knowledgeBaseScopeFingerprint}
 *   (`run-aggregate.ts`). Members with identical KB access — nearly everyone,
 *   since the seeded `knowledgeBase` baseline is `Edit` — keep sharing one entry.
 *   🔴 Filtering here WITHOUT that key fork would serve the first caller's
 *   numbers to the whole org, in both directions.
 * - KB dashboard widgets are shipped product; refusing them costs a widget type.
 *
 * Adding a further system source means answering the same three questions for
 * it, not inheriting this answer.
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
  /**
   * The viewer's viewable-KB allow-list from `viewableKnowledgeBaseIds`, or
   * `'all'` for a headless caller (§8.2's `capabilities: undefined` convention).
   *
   * 🔴 **Required, not optional.** An omitted scope would silently aggregate
   * every article in the org — the exact defect plan v3/06 R9 records — and an
   * optional field makes that omission a default rather than a typecheck error.
   * Only `prepareAggregate` builds these params, and it resolves the list once
   * per run so the WHERE and the result-cache key describe the same set.
   */
  viewableKbIds: string[] | 'all'
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
 *
 * For `article` the WHERE **does** carry a row policy, from
 * `params.viewableKbIds`. Its caller owns the other half of that fix: the same
 * list must fork the result-cache key, or one viewer's counts are served to the
 * next.
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
    viewableKbIds,
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

  // The article row policy (plan v3/06 R9). Qualified to `"Article"`, which is
  // this query's only FROM entry — hence the table-id guard rather than a bare
  // `viewableKbIds !== 'all'`: no other system source may ever be handed it.
  //
  // ⚠ There is deliberately **no "this viewer holds every KB ⇒ skip it"
  // shortcut**. `viewableKnowledgeBaseIds` answers `'all'` only for an ABSENT
  // viewer, because `kind: 'source'` KBs are excluded unconditionally — for
  // OWNER too — so on any org with a KnowledgeSource the predicate still
  // narrows. An empty list renders `= ANY('{}')`, which matches nothing: the
  // aggregate returns 0 rather than the org's total, which is the fail-closed
  // direction and the honest answer for a viewer with no KB at all.
  if (tableId === 'article' && viewableKbIds !== 'all') {
    whereParts.push(articleVisibilitySql({ organizationId, viewableKbIds }))
  }

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
