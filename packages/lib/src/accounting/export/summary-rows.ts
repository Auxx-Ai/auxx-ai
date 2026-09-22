// packages/lib/src/accounting/export/summary-rows.ts
// The Outbox's Summary view: one row per bucket in the export window, whether or
// not a live batch holds it (plans/accounting/tasks/95-the-summary-is-the-row.md §3.2).

import { type Database, schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import type { ExportAvenue } from '../ledger/setup/export-settings'
import {
  type ExportBatchState,
  type ExportBatchTab,
  type SummaryRowStatus,
  summaryRowStatus,
  type UnbuiltGroupKey,
  unbuiltGroupKeyString,
} from './client'
import { type ExportBatchRow, listExportBatches } from './queue-reads'
import { bucketCtes, type SummaryScope, summaryDayKey, summaryScope } from './summary-ctes'

export interface SummaryRow extends UnbuiltGroupKey {
  /** `unbuiltGroupKeyString` of the key - stable across reads. */
  key: string
  /** The grain key when it is a day or a month, else the bucket's earliest posting's day. */
  dayKey: string
  /** Over every posting in the bucket, held or not. */
  totalMinor: number
  memberCount: number
  /** Postings the live batch does not hold; equals `memberCount` when there is no batch. */
  newCount: number
  txnDateFrom: string
  txnDateTo: string
  firstPostingId: string
  status: SummaryRowStatus
  /** The live batch on the key; null when none (or withdrawn between the page and its hydration). */
  batch: ExportBatchRow | null
}

export interface SummaryRowFilter {
  organizationId: string
  categories?: readonly ExportAvenue[]
  /** Literal match on a member's doc number, or the batch's doc number, provider id or last error. */
  search?: string
  /** `YYYY-MM-DD`, inclusive: keeps a bucket with a posting in range. Never widens the window. */
  from?: string
  to?: string
}

export interface ListSummaryRowsInput extends SummaryRowFilter {
  tab: ExportBatchTab
  /** `desc` when absent. */
  direction?: 'asc' | 'desc'
  limit: number
  offset?: number
}

interface RawSummaryRow {
  avenue: ExportAvenue
  grainKey: string
  storeId: string
  railId: string
  currency: string
  totalMinor: string | number
  txnDateFrom: string
  txnDateTo: string
  memberCount: number
  newCount: number
  firstPostingId: string
  dayKey: string
  batchId: string | null
  batchState: ExportBatchState | null
  total?: number
}

const keyMatch = (a: string, b: string) =>
  sql.raw(
    ['avenue', 'grainKey', 'storeId', 'railId', 'currency']
      .map((column) => `${a}."${column}" = ${b}."${column}"`)
      .join(' AND ')
  )

function tabWhere(tab: ExportBatchTab): SQL {
  if (tab === 'ready') return sql`("batchState" IS NULL OR "batchState" IN ('ready', 'sending'))`
  return sql`"batchState" = ${tab}`
}

/** `WITH ... row`: one row per bucket with its live batch, every filter but the tab applied. */
function summaryRowCtes(input: SummaryRowFilter, scope: SummaryScope): SQL {
  const avenues = input.categories?.length ? [...input.categories] : undefined
  const search = input.search || null
  return sql`
    ${bucketCtes({ organizationId: input.organizationId, avenues, held: 'include' }, scope)},
    live AS (
      SELECT b."id", b."state", b."avenue", b."grainKey",
        coalesce(b."storeId", '') AS "storeId", coalesce(b."railId", '') AS "railId", b."currency",
        concat_ws(' ', b."id", b."payload"->>'docNumber', b."providerObjectId", b."lastError") AS "searchText"
      FROM ${schema.ExportBatch} b
      WHERE b."organizationId" = ${input.organizationId} AND b."bookId" = ${scope.bookId}
        AND b."state" <> 'withdrawn'
    ),
    grp AS (
      SELECT m."avenue", m."grainKey", m."storeId", m."railId", m."currency",
        sum(m."totalMinor")::bigint AS "totalMinor",
        min(m."txnDate")::text AS "txnDateFrom", max(m."txnDate")::text AS "txnDateTo",
        count(*)::int AS "memberCount",
        (count(*) FILTER (WHERE m."heldBy" IS NULL))::int AS "newCount",
        (array_agg(m."id" ORDER BY m."txnDate", m."id"))[1] AS "firstPostingId",
        ${
          input.from || input.to
            ? sql`bool_or(m."txnDate" >= coalesce(${input.from ?? null}::date, m."txnDate")
                AND m."txnDate" <= coalesce(${input.to ?? null}::date, m."txnDate"))`
            : sql`true`
        } AS "inRange",
        ${
          search
            ? sql`bool_or(strpos(lower(coalesce(m."docNumber", '')), lower(${search})) > 0)`
            : sql`true`
        } AS "docMatched"
      FROM member m
      GROUP BY 1, 2, 3, 4, 5
    ),
    row AS (
      SELECT g."avenue", g."grainKey", g."storeId", g."railId", g."currency", g."totalMinor",
        g."txnDateFrom", g."txnDateTo", g."memberCount", g."newCount", g."firstPostingId",
        CASE WHEN g."grainKey" ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$' THEN g."grainKey"
          ELSE g."txnDateFrom" END AS "dayKey",
        l."id" AS "batchId", l."state" AS "batchState"
      FROM grp g
      LEFT JOIN live l ON ${keyMatch('l', 'g')}
      WHERE g."inRange"
        AND (l."id" IS NOT NULL OR EXISTS (SELECT 1 FROM journal j WHERE ${keyMatch('j', 'g')}))
        ${
          search
            ? sql`AND (g."docMatched" OR strpos(lower(coalesce(l."searchText", '')), lower(${search})) > 0)`
            : sql``
        }
    )`
}

function toSummaryRow(row: RawSummaryRow, batch: ExportBatchRow | null): SummaryRow {
  const group: UnbuiltGroupKey = {
    avenue: row.avenue,
    grainKey: row.grainKey,
    storeId: row.storeId || null,
    railId: row.railId || null,
    currency: row.currency,
  }
  return {
    ...group,
    key: unbuiltGroupKeyString(group),
    dayKey: row.dayKey ?? summaryDayKey(row.grainKey, row.txnDateFrom),
    totalMinor: Number(row.totalMinor),
    memberCount: row.memberCount,
    newCount: row.newCount,
    txnDateFrom: row.txnDateFrom,
    txnDateTo: row.txnDateTo,
    firstPostingId: row.firstPostingId,
    status: summaryRowStatus(row.batchState, row.newCount),
    batch,
  }
}

/**
 * One page of the Summary view: bucket and live batch come from one statement,
 * ordered by day then key; the batches are hydrated by id afterwards.
 */
export async function listSummaryRows(
  db: Database,
  input: ListSummaryRowsInput
): Promise<Result<{ items: SummaryRow[]; total: number }, Error>> {
  try {
    const scope = await summaryScope(db, { organizationId: input.organizationId })
    if (!scope) return ok({ items: [], total: 0 })
    const dir = input.direction === 'asc' ? sql`ASC` : sql`DESC`
    const offset = input.offset ?? 0
    const result = await db.execute(sql`
      ${summaryRowCtes(input, scope)}
      SELECT *, (count(*) OVER ())::int AS "total" FROM row
      WHERE ${tabWhere(input.tab)}
      ORDER BY "dayKey" ${dir} NULLS LAST, "avenue", "grainKey", "storeId", "railId", "currency"
      LIMIT ${input.limit} OFFSET ${offset}
    `)
    const rows = result.rows as unknown as RawSummaryRow[]

    let total = rows[0]?.total ?? 0
    if (rows.length === 0 && offset > 0) {
      const counted = await db.execute(sql`
        ${summaryRowCtes(input, scope)}
        SELECT count(*)::int AS "total" FROM row WHERE ${tabWhere(input.tab)}
      `)
      total = Number((counted.rows[0] as { total?: number } | undefined)?.total ?? 0)
    }

    const batchIds = rows.flatMap((row) => (row.batchId ? [row.batchId] : []))
    const batches = new Map<string, ExportBatchRow>()
    if (batchIds.length > 0) {
      const hydrated = await listExportBatches(db, {
        organizationId: input.organizationId,
        batchIds,
        limit: batchIds.length,
      })
      if (hydrated.isErr()) return err(hydrated.error)
      for (const batch of hydrated.value) batches.set(batch.id, batch)
    }

    return ok({
      items: rows.map((row) =>
        toSummaryRow(row, row.batchId ? (batches.get(row.batchId) ?? null) : null)
      ),
      total: Number(total),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Every tab's row count over the whole window, unfiltered - the Outbox tab tallies. */
export async function countSummaryRows(
  db: Database,
  input: SummaryRowFilter
): Promise<Result<Record<ExportBatchTab, number>, Error>> {
  const counts: Record<ExportBatchTab, number> = { ready: 0, sent: 0, failed: 0 }
  try {
    const scope = await summaryScope(db, { organizationId: input.organizationId })
    if (!scope) return ok(counts)
    const result = await db.execute(sql`
      ${summaryRowCtes(input, scope)}
      SELECT CASE WHEN "batchState" IS NULL OR "batchState" = 'sending' THEN 'ready'
          ELSE "batchState" END AS "tab",
        count(*)::int AS "total"
      FROM row GROUP BY 1
    `)
    for (const row of result.rows as unknown as Array<{ tab: ExportBatchTab; total: number }>)
      if (row.tab in counts) counts[row.tab] = Number(row.total)
    return ok(counts)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
