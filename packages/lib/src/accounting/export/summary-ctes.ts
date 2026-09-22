// packages/lib/src/accounting/export/summary-ctes.ts
// The export window and the bucket CTEs the summary reads share
// (plans/accounting/tasks/95-the-summary-is-the-row.md §3.2).

import { type Database, schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import {
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  isSummaryGrainAvenue,
} from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { readActiveBookConnection } from '../providers/book-connections'

export interface SummaryScope {
  from: string
  to: string
  settings: ExportSettings
  /** The active connection's book - a live batch is keyed on it (`ExportBatch_grain_key`). */
  bookId: string
}

export interface SummaryWindowInput {
  organizationId: string
  /** `YYYY-MM-DD`, inclusive; never earlier than the export cutover. */
  from?: string
  /** `YYYY-MM-DD`, inclusive; defaults to tomorrow. */
  to?: string
}

/** Empty outside Summary mode, without a connected book, or when the window closes before it opens. */
export async function summaryScope(
  db: Database,
  input: SummaryWindowInput
): Promise<SummaryScope | null> {
  const settings = await readExportSettings(input.organizationId)
  if (settings.mode !== 'summary') return null
  const connection = await readActiveBookConnection(db, input.organizationId)
  if (!connection) return null

  const cutover =
    settings.cutover && settings.cutover > connection.exportFromDate
      ? settings.cutover
      : connection.exportFromDate
  const from = input.from && input.from > cutover ? input.from : cutover
  // A book-zone date can run a day ahead of UTC; one day of slack covers every zone.
  const to = input.to ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  if (from > to) return null
  return { from, to, settings, bookId: connection.bookId }
}

/** `summaryGrainKey` in SQL: the day, the month, the payout (else the day), or the posting's own id for a grain-less avenue. */
export function grainKeySql(settings: ExportSettings): SQL {
  const arms = EXPORT_AVENUES.filter(isSummaryGrainAvenue).map((avenue) => {
    const grain = settings.summaryGrain[avenue]
    if (grain === 'month') return sql`WHEN ${avenue} THEN to_char(p."txnDate", 'YYYY-MM')`
    if (grain === 'payout')
      return sql`WHEN ${avenue} THEN coalesce(nullif(p."payoutId", ''), p."txnDate"::text)`
    return sql`WHEN ${avenue} THEN p."txnDate"::text`
  })
  return sql`CASE p."avenue" ${sql.join(arms, sql` `)} ELSE p."id" END`
}

export interface BucketCteInput {
  organizationId: string
  avenues?: readonly ExportAvenue[]
  /**
   * `exclude` keeps only postings no live batch holds (Build's candidates);
   * `include` also keeps those held by the live batch on the posting's own key.
   */
  held: 'exclude' | 'include'
}

/**
 * `WITH member, account, journal`: `member` is each posted posting in the window
 * with its bucket key and `heldBy` (the live batch holding it, or null);
 * `journal` is each bucket Build would make a journal of - at least two
 * non-zero account-and-side lines, never netted, the builder's own rule (91 D9).
 */
export function bucketCtes(input: BucketCteInput, scope: SummaryScope): SQL {
  const avenues = input.avenues?.length ? [...input.avenues] : null
  const grainKey = grainKeySql(scope.settings)
  return sql`
    WITH member AS (
      SELECT p."id", p."avenue", ${grainKey} AS "grainKey",
        coalesce(p."storeId", '') AS "storeId", coalesce(p."railId", '') AS "railId",
        p."currency", p."txnDate", p."totalMinor", p."docNumber", p."postingType",
        nullif(p."built"->>'memo', '') AS "memo", hb."id" AS "heldBy"
      FROM ${schema.GlPosting} p
      LEFT JOIN ${schema.ExportBatchPosting} bp
        ON bp."organizationId" = p."organizationId" AND bp."glPostingId" = p."id"
          AND bp."withdrawnAt" IS NULL
      LEFT JOIN ${schema.ExportBatch} hb
        ON hb."organizationId" = bp."organizationId" AND hb."id" = bp."batchId"
      WHERE p."organizationId" = ${input.organizationId}
        AND p."status" = 'posted' AND p."avenue" IS NOT NULL
        AND p."txnDate" >= ${scope.from}::date AND p."txnDate" <= ${scope.to}::date
        ${
          avenues
            ? sql`AND p."avenue" IN (${sql.join(
                avenues.map((avenue) => sql`${avenue}`),
                sql`, `
              )})`
            : sql``
        }
        AND ${
          input.held === 'exclude'
            ? sql`bp."id" IS NULL`
            : // A posting held by a batch on some other key (another book, a mode switch) is not this bucket's.
              sql`(bp."id" IS NULL OR (hb."bookId" = ${scope.bookId}
                AND hb."avenue" = p."avenue" AND hb."grainKey" = ${grainKey}
                AND coalesce(hb."storeId", '') = coalesce(p."storeId", '')
                AND coalesce(hb."railId", '') = coalesce(p."railId", '')
                AND hb."currency" = p."currency"))`
        }
    ),
    account AS (
      SELECT m."avenue", m."grainKey", m."storeId", m."railId", m."currency", l."glAccountId",
        l."direction", sum(l."amountMinor") AS amount
      FROM member m
      JOIN ${schema.GlPostingLine} l
        ON l."organizationId" = ${input.organizationId} AND l."glPostingId" = m."id"
      GROUP BY 1, 2, 3, 4, 5, 6, 7
    ),
    journal AS (
      SELECT "avenue", "grainKey", "storeId", "railId", "currency"
      FROM account WHERE amount <> 0
      GROUP BY 1, 2, 3, 4, 5 HAVING count(*) >= 2
    )`
}

/** The row's day: a day- or month-shaped grain key, else the bucket's earliest posting. */
export function summaryDayKey(grainKey: string, txnDateFrom: string): string {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(grainKey) ? grainKey : txnDateFrom
}
