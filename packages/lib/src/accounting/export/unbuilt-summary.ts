// packages/lib/src/accounting/export/unbuilt-summary.ts
// Summary mode's rows that no batch holds yet: what the Ready tab shows for a
// posted entry between Approve and Build (TARGET §3, §6), grouped in SQL the
// way `readLedgerSummary` groups in memory, and paged.

import { type Database, schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import {
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  isSummaryGrainAvenue,
} from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import type { PostingType } from '../ledger/types'
import { readActiveBookConnection } from '../providers/book-connections'
import { type UnbuiltGroupKey, unbuiltGroupKeyString } from './client'
import type { ExportBatchMember } from './queue-reads'

export type { UnbuiltGroupKey } from './client'

export interface UnbuiltSummaryRow extends UnbuiltGroupKey {
  /** The grouping key as one string, stable across reads so the UI can track a row. */
  key: string
  totalMinor: number
  txnDateFrom: string
  txnDateTo: string
  memberCount: number
  /** The earliest posting in the group: the drawer's target when the group IS one posting. */
  firstPostingId: string
}

/** The last row of a page, as `readUnbuiltSummaryPage` orders them. NULL store and rail read as `''`. */
export interface UnbuiltCursor {
  txnDateTo: string
  avenue: string
  grainKey: string
  storeId: string
  railId: string
  currency: string
}

export interface UnbuiltSummaryFilter {
  organizationId: string
  /** `YYYY-MM-DD`, inclusive; defaults to the export cutover. */
  from?: string
  /** `YYYY-MM-DD`, inclusive; defaults to today. */
  to?: string
  avenues?: readonly ExportAvenue[]
  /** A literal match on a member's document number. */
  search?: string
}

export interface ReadUnbuiltSummaryPageInput extends UnbuiltSummaryFilter {
  limit: number
  cursor?: UnbuiltCursor
}

interface Scope {
  from: string
  to: string
  settings: ExportSettings
}

/** Empty outside Summary mode, without a connected book, or when the window closes before it opens. */
async function unbuiltScope(db: Database, input: UnbuiltSummaryFilter): Promise<Scope | null> {
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
  return { from, to, settings }
}

/** `summaryGrainKey` in SQL: the day, the month, the payout (else the day), or the posting's own id for a grain-less avenue. */
function grainKeySql(settings: ExportSettings): SQL {
  const arms = EXPORT_AVENUES.filter(isSummaryGrainAvenue).map((avenue) => {
    const grain = settings.summaryGrain[avenue]
    if (grain === 'month') return sql`WHEN ${avenue} THEN to_char(p."txnDate", 'YYYY-MM')`
    if (grain === 'payout')
      return sql`WHEN ${avenue} THEN coalesce(nullif(p."payoutId", ''), p."txnDate"::text)`
    return sql`WHEN ${avenue} THEN p."txnDate"::text`
  })
  return sql`CASE p."avenue" ${sql.join(arms, sql` `)} ELSE p."id" END`
}

/**
 * The CTEs every read shares: `member` is each posted, unbatched posting with
 * its group key; `journal` is each group Build would make a journal of - at
 * least two non-zero account-and-side lines, the builder's own rule (91 D9).
 */
function unbuiltCtes(input: UnbuiltSummaryFilter, scope: Scope): SQL {
  const avenues = input.avenues?.length ? [...input.avenues] : null
  return sql`
    WITH member AS (
      SELECT p."id", p."avenue", ${grainKeySql(scope.settings)} AS "grainKey",
        coalesce(p."storeId", '') AS "storeId", coalesce(p."railId", '') AS "railId",
        p."currency", p."txnDate", p."totalMinor", p."docNumber", p."postingType"
      FROM ${schema.GlPosting} p
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
        AND NOT EXISTS (SELECT 1 FROM ${schema.ExportBatchPosting} b
          WHERE b."organizationId" = p."organizationId" AND b."glPostingId" = p."id"
            AND b."withdrawnAt" IS NULL)
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
    ),
    grp AS (
      SELECT m."avenue", m."grainKey", m."storeId", m."railId", m."currency",
        sum(m."totalMinor")::bigint AS "totalMinor",
        min(m."txnDate")::text AS "txnDateFrom", max(m."txnDate")::text AS "txnDateTo",
        count(*)::int AS "memberCount",
        (array_agg(m."id" ORDER BY m."txnDate", m."id"))[1] AS "firstPostingId",
        ${
          input.search
            ? sql`bool_or(strpos(lower(coalesce(m."docNumber", '')), lower(${input.search})) > 0)`
            : sql`true`
        } AS matched
      FROM member m
      GROUP BY 1, 2, 3, 4, 5
    ),
    row AS (
      SELECT g.* FROM grp g
      JOIN journal j ON j."avenue" = g."avenue" AND j."grainKey" = g."grainKey"
        AND j."storeId" = g."storeId" AND j."railId" = g."railId" AND j."currency" = g."currency"
      WHERE g.matched
    )`
}

interface GroupRow {
  avenue: ExportAvenue
  grainKey: string
  storeId: string
  railId: string
  currency: string
  totalMinor: string | number
  txnDateFrom: string
  txnDateTo: string
  memberCount: number
  firstPostingId: string
}

function toRow(row: GroupRow): UnbuiltSummaryRow {
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
    totalMinor: Number(row.totalMinor),
    txnDateFrom: row.txnDateFrom,
    txnDateTo: row.txnDateTo,
    memberCount: row.memberCount,
    firstPostingId: row.firstPostingId,
  }
}

function cursorOf(row: UnbuiltSummaryRow): UnbuiltCursor {
  return {
    txnDateTo: row.txnDateTo,
    avenue: row.avenue,
    grainKey: row.grainKey,
    storeId: row.storeId ?? '',
    railId: row.railId ?? '',
    currency: row.currency,
  }
}

/**
 * One page of the summary groups Build would create right now, newest first.
 *
 * Keyset-paged on the row's full sort key rather than by offset: Build removes
 * rows from this list between pages, and an offset would skip past the rows
 * that moved up.
 */
export async function readUnbuiltSummaryPage(
  db: Database,
  input: ReadUnbuiltSummaryPageInput
): Promise<Result<{ items: UnbuiltSummaryRow[]; nextCursor?: UnbuiltCursor }, Error>> {
  try {
    const scope = await unbuiltScope(db, input)
    if (!scope) return ok({ items: [] })
    const c = input.cursor
    const result = await db.execute(sql`
      ${unbuiltCtes(input, scope)}
      SELECT * FROM row
      ${
        c
          ? sql`WHERE ("txnDateTo"::date, "avenue", "grainKey", "storeId", "railId", "currency")
              < (${c.txnDateTo}::date, ${c.avenue}, ${c.grainKey}, ${c.storeId}, ${c.railId}, ${c.currency})`
          : sql``
      }
      ORDER BY "txnDateTo" DESC, "avenue" DESC, "grainKey" DESC, "storeId" DESC, "railId" DESC, "currency" DESC
      LIMIT ${input.limit}
    `)
    const items = (result.rows as unknown as GroupRow[]).map(toRow)
    const last = items[items.length - 1]
    return ok({
      items,
      ...(last && items.length === input.limit ? { nextCursor: cursorOf(last) } : {}),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** How many groups `readUnbuiltSummaryPage` would page through - the Ready tab's badge. */
export async function countUnbuiltSummaryRows(
  db: Database,
  input: UnbuiltSummaryFilter
): Promise<Result<number, Error>> {
  try {
    const scope = await unbuiltScope(db, input)
    if (!scope) return ok(0)
    const result = await db.execute(sql`
      ${unbuiltCtes(input, scope)}
      SELECT count(*)::int AS "total" FROM row
    `)
    return ok(Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** The postings inside one group, oldest first - read when a row is opened, never with the list. */
export async function readUnbuiltSummaryMembers(
  db: Database,
  input: { organizationId: string; group: UnbuiltGroupKey }
): Promise<Result<ExportBatchMember[], Error>> {
  try {
    const scope = await unbuiltScope(db, input)
    if (!scope) return ok([])
    const { group } = input
    const result = await db.execute(sql`
      ${unbuiltCtes({ organizationId: input.organizationId, avenues: [group.avenue] }, scope)}
      SELECT m."id" AS "glPostingId", m."postingType", m."docNumber", m."txnDate"::text AS "txnDate",
        m."totalMinor"
      FROM member m
      WHERE m."avenue" = ${group.avenue} AND m."grainKey" = ${group.grainKey}
        AND m."storeId" = ${group.storeId ?? ''} AND m."railId" = ${group.railId ?? ''}
        AND m."currency" = ${group.currency}
      ORDER BY m."txnDate", m."id"
    `)
    return ok(
      (
        result.rows as unknown as Array<{
          glPostingId: string
          postingType: PostingType
          docNumber: string | null
          txnDate: string
          totalMinor: string | number
        }>
      ).map((row) => ({ ...row, totalMinor: Number(row.totalMinor) }))
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
