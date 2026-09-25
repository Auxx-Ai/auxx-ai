// packages/lib/src/mrp/reads/summary.ts

import { type Database, schema } from '@auxx/database'
import { addDaysToDayKey } from '@auxx/utils/calendar-day'
import { and, eq, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import {
  MRP_FLAGS,
  MRP_ORDER_MODES,
  MRP_SUGGESTION_KINDS,
  MRP_SUPPLY_TYPES,
  type MrpFlag,
  type MrpOrderMode,
  type MrpSuggestionKind,
  type MrpSupplyType,
} from '../client'
import { guard } from './guard'
import { readRecordNames } from './labels'
import { loadRun, type MrpRunRef } from './runs'

const I = schema.MrpPlanRunItem

export interface MrpSummaryCounts {
  total: number
  overdue: number
  /** Not overdue, order-by within 7 days of the run's day: the "This week" tab. */
  thisWeek: number
  within30Days: number
  /** Order-by beyond 7 days. */
  later: number
  flagged: number
  /** No suggestion and no flag. */
  fine: number
  buffered: number
  unbuffered: number
  bySuggestionKind: Record<MrpSuggestionKind, number>
  bySupplyType: Record<MrpSupplyType, number>
  byOrderMode: Record<MrpOrderMode, number>
  byFlag: Record<MrpFlag, number>
}

export interface MrpSupplierFacet {
  supplierId: string
  name: string | null
  count: number
}

export interface MrpSummaryFacets {
  /** Every `suggestedSupplierId` in the run, most items first. */
  bySupplier: MrpSupplierFacet[]
}

export interface MrpSummary {
  run: MrpRunRef | null
  counts: MrpSummaryCounts | null
  facets: MrpSummaryFacets | null
}

/** The "This week" / "Later" boundaries, inclusive, relative to the run's day. */
export function orderByHorizons(asOfDay: string): { week: string; month: string } {
  return { week: addDaysToDayKey(asOfDay, 7), month: addDaysToDayKey(asOfDay, 30) }
}

const countIf = (predicate: SQL) => sql<number>`count(*) filter (where ${predicate})::int`

/** One aggregate row's columns, keyed so {@link shapeSummary} can fold them back. */
function summaryColumns(asOfDay: string): Record<string, SQL<number>> {
  const { week, month } = orderByHorizons(asOfDay)
  const columns: Record<string, SQL<number>> = {
    total: sql<number>`count(*)::int`,
    overdue: countIf(sql`${I.isOverdue}`),
    thisWeek: countIf(sql`not ${I.isOverdue} and ${I.orderByDate} <= ${week}`),
    within30Days: countIf(sql`not ${I.isOverdue} and ${I.orderByDate} <= ${month}`),
    later: countIf(sql`not ${I.isOverdue} and ${I.orderByDate} > ${week}`),
    flagged: countIf(sql`cardinality(${I.flags}) > 0`),
    fine: countIf(sql`${I.suggestionKind} is null and cardinality(${I.flags}) = 0`),
    buffered: countIf(sql`${I.buffered}`),
  }
  for (const kind of MRP_SUGGESTION_KINDS)
    columns[`kind:${kind}`] = countIf(sql`${I.suggestionKind} = ${kind}`)
  for (const type of MRP_SUPPLY_TYPES)
    columns[`supply:${type}`] = countIf(sql`${I.supplyType} = ${type}`)
  for (const mode of MRP_ORDER_MODES)
    columns[`mode:${mode}`] = countIf(sql`${I.orderMode} = ${mode}`)
  for (const flag of MRP_FLAGS) columns[`flag:${flag}`] = countIf(sql`${flag} = any(${I.flags})`)
  return columns
}

function fold<K extends string>(row: Record<string, unknown>, prefix: string, keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, Number(row[`${prefix}:${k}`] ?? 0)])) as Record<
    K,
    number
  >
}

/** The aggregate row as the tab strip and filters read it. */
export function shapeSummary(row: Record<string, unknown>): MrpSummaryCounts {
  const n = (key: string) => Number(row[key] ?? 0)
  return {
    total: n('total'),
    overdue: n('overdue'),
    thisWeek: n('thisWeek'),
    within30Days: n('within30Days'),
    later: n('later'),
    flagged: n('flagged'),
    fine: n('fine'),
    buffered: n('buffered'),
    unbuffered: n('total') - n('buffered'),
    bySuggestionKind: fold(row, 'kind', MRP_SUGGESTION_KINDS),
    bySupplyType: fold(row, 'supply', MRP_SUPPLY_TYPES),
    byOrderMode: fold(row, 'mode', MRP_ORDER_MODES),
    byFlag: fold(row, 'flag', MRP_FLAGS),
  }
}

/** Supplier counts labelled, most items first, then by name. */
export function shapeSupplierFacet(
  counts: ReadonlyArray<{ supplierId: string; count: number }>,
  names: ReadonlyMap<string, string | null>
): MrpSupplierFacet[] {
  return counts
    .map((c) => ({
      supplierId: c.supplierId,
      name: names.get(c.supplierId) ?? null,
      count: c.count,
    }))
    .sort((a, b) => b.count - a.count || (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Tab and filter counts for the action list header (07 §4.1), one aggregate over the run's items. */
export async function readSummary(
  db: Database,
  organizationId: string,
  input: { runId?: string | null } = {}
): Promise<Result<MrpSummary, Error>> {
  return guard(
    async () => {
      const run = await loadRun(db, organizationId, input.runId)
      if (!run) return { run: null, counts: null, facets: null }
      const scope = and(eq(I.organizationId, organizationId), eq(I.mrpPlanRunId, run.id))
      const [[row], supplierRows] = await Promise.all([
        db.select(summaryColumns(run.asOfDay)).from(I).where(scope),
        db
          .select({ supplierId: I.suggestedSupplierId, count: sql<number>`count(*)::int` })
          .from(I)
          .where(and(scope, isNotNull(I.suggestedSupplierId)))
          .groupBy(I.suggestedSupplierId),
      ])
      const counts = supplierRows.flatMap((r) =>
        r.supplierId ? [{ supplierId: r.supplierId, count: Number(r.count) }] : []
      )
      const names = await readRecordNames(
        db,
        organizationId,
        'company',
        counts.map((c) => c.supplierId)
      )
      return {
        run,
        counts: shapeSummary(row ?? {}),
        facets: { bySupplier: shapeSupplierFacet(counts, names) },
      }
    },
    'Failed to read the plan summary',
    { organizationId, runId: input.runId }
  )
}
