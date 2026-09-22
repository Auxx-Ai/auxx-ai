// packages/lib/src/accounting/export/unbuilt-summary.ts
// Summary mode's rows that no batch holds yet: what the Ready tab shows for a
// posted entry between Approve and Build (TARGET §3, §6).

import { type Database, schema } from '@auxx/database'
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { readLedgerSummary } from '../ledger/reads/ledger-summary'
import type { ExportAvenue } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { readActiveBookConnection } from '../providers/book-connections'
import type { ExportBatchMember } from './queue-reads'

export interface UnbuiltSummaryRow {
  /** The summary grouping key, stable across reads so the UI can track a row. */
  key: string
  avenue: ExportAvenue
  grainKey: string
  storeId: string | null
  railId: string | null
  currency: string
  totalMinor: number
  txnDateFrom: string
  txnDateTo: string
  members: ExportBatchMember[]
}

export interface ReadUnbuiltSummaryRowsInput {
  organizationId: string
  /** `YYYY-MM-DD`, inclusive; defaults to the export cutover. */
  from?: string
  /** `YYYY-MM-DD`, inclusive; defaults to today. */
  to?: string
  avenues?: readonly ExportAvenue[]
}

/**
 * The summary groups Build would create right now, with their member postings.
 * Empty outside Summary mode or without a connected book. Same eligibility as
 * `buildExportBatches`: posted, exportable, dated on or after the cutover, and
 * not a live member of any batch.
 */
export async function readUnbuiltSummaryRows(
  db: Database,
  input: ReadUnbuiltSummaryRowsInput
): Promise<Result<UnbuiltSummaryRow[], Error>> {
  const { organizationId } = input
  try {
    const settings = await readExportSettings(organizationId)
    if (settings.mode !== 'summary') return ok([])
    const connection = await readActiveBookConnection(db, organizationId)
    if (!connection) return ok([])

    const cutover =
      settings.cutover && settings.cutover > connection.exportFromDate
        ? settings.cutover
        : connection.exportFromDate
    const from = input.from && input.from > cutover ? input.from : cutover
    // A book-zone date can run a day ahead of UTC; one day of slack covers every zone.
    const to = input.to ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    if (from > to) return ok([])

    const batched = await db
      .select({ glPostingId: schema.ExportBatchPosting.glPostingId })
      .from(schema.ExportBatchPosting)
      .innerJoin(
        schema.GlPosting,
        and(
          eq(schema.GlPosting.organizationId, schema.ExportBatchPosting.organizationId),
          eq(schema.GlPosting.id, schema.ExportBatchPosting.glPostingId)
        )
      )
      .where(
        and(
          eq(schema.ExportBatchPosting.organizationId, organizationId),
          isNull(schema.ExportBatchPosting.withdrawnAt),
          gte(schema.GlPosting.txnDate, from),
          lte(schema.GlPosting.txnDate, to)
        )
      )

    const summary = await readLedgerSummary(db, {
      organizationId,
      from,
      to,
      grainByAvenue: settings.summaryGrain,
      excludePostingIds: batched.map((row) => row.glPostingId),
    })
    if (summary.isErr()) return err(summary.error)

    // The builder skips a group that would not make a journal; the row should not promise one.
    const groups = summary.value.filter(
      (group) =>
        group.postingIds.length > 0 &&
        group.lines.length >= 2 &&
        (!input.avenues?.length || input.avenues.includes(group.avenue))
    )
    if (groups.length === 0) return ok([])

    const postingIds = groups.flatMap((group) => group.postingIds)
    const postings = await db
      .select({
        glPostingId: schema.GlPosting.id,
        postingType: schema.GlPosting.postingType,
        docNumber: schema.GlPosting.docNumber,
        txnDate: schema.GlPosting.txnDate,
        totalMinor: schema.GlPosting.totalMinor,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.id, postingIds)
        )
      )
    const memberById = new Map(postings.map((row) => [row.glPostingId, row]))

    return ok(
      groups.map((group) => ({
        key: [group.avenue, group.grainKey, group.storeId ?? '', group.railId ?? '', group.currency]
          .join(' ')
          .trim(),
        avenue: group.avenue,
        grainKey: group.grainKey,
        storeId: group.storeId,
        railId: group.railId,
        currency: group.currency,
        totalMinor: group.totalMinor,
        txnDateFrom: group.txnDateFrom,
        txnDateTo: group.txnDateTo,
        members: group.postingIds
          .map((id) => memberById.get(id))
          .filter((member): member is NonNullable<typeof member> => member !== undefined)
          .sort(
            (a, b) =>
              a.txnDate.localeCompare(b.txnDate) || a.glPostingId.localeCompare(b.glPostingId)
          ),
      }))
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
