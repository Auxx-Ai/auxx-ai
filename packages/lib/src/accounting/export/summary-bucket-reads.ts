// packages/lib/src/accounting/export/summary-bucket-reads.ts
// One Summary row opened in its drawer: the journal it sends and the postings behind it
// (plans/accounting/tasks/95-the-summary-is-the-row.md §3.2).

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { type LedgerSummaryLine, sumSummaryLines } from '../ledger/reads/ledger-summary'
import type { ExportBatchState, UnbuiltGroupKey } from './client'
import { exportJournalSchema } from './payloads'
import { type ExportBatchMember, type ExportBatchRow, listExportBatches } from './queue-reads'
import { summaryScope } from './summary-ctes'
import { readUnbuiltSummaryMembers } from './unbuilt-summary'

export interface SummaryJournalLine extends LedgerSummaryLine {
  /** The newest posting-time snapshot among the bucket's lines; null when none carried one. */
  accountName: string | null
}

export interface SummaryBucketDetail {
  /** The live batch on the key; null until the bucket is built. */
  batch: ExportBatchRow | null
  /** The batch's frozen payload lines, or with no batch the lines a build would sum now. */
  lines: SummaryJournalLine[]
  /** The postings `lines` is summed from. */
  members: ExportBatchMember[]
  /** Postings in the bucket the live batch does not hold, so not in `lines`. */
  newMembers: ExportBatchMember[]
}

/** The live batch on a bucket's key in this book - `ExportBatch_grain_key` allows one. */
export async function readLiveBucketBatch(
  db: Database,
  organizationId: string,
  bookId: string,
  key: UnbuiltGroupKey
): Promise<{ id: string; state: ExportBatchState } | null> {
  const [row] = await db
    .select({ id: schema.ExportBatch.id, state: schema.ExportBatch.state })
    .from(schema.ExportBatch)
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.bookId, bookId),
        eq(schema.ExportBatch.avenue, key.avenue),
        eq(schema.ExportBatch.grainKey, key.grainKey),
        sql`coalesce(${schema.ExportBatch.storeId}, '') = ${key.storeId ?? ''}`,
        sql`coalesce(${schema.ExportBatch.railId}, '') = ${key.railId ?? ''}`,
        eq(schema.ExportBatch.currency, key.currency),
        ne(schema.ExportBatch.state, 'withdrawn')
      )
    )
    .limit(1)
  return row ?? null
}

/** One bucket's journal and members; empty outside Summary mode or without a book. */
export async function readSummaryBucket(
  db: Database,
  input: { organizationId: string; key: UnbuiltGroupKey }
): Promise<Result<SummaryBucketDetail, Error>> {
  const { organizationId, key } = input
  try {
    const scope = await summaryScope(db, { organizationId })
    if (!scope) return ok({ batch: null, lines: [], members: [], newMembers: [] })

    const unbuilt = await readUnbuiltSummaryMembers(db, { organizationId, group: key })
    if (unbuilt.isErr()) return err(unbuilt.error)

    const live = await readLiveBucketBatch(db, organizationId, scope.bookId, key)
    let batch: ExportBatchRow | null = null
    let payload: unknown = null
    if (live) {
      const batches = await listExportBatches(db, { organizationId, batchIds: [live.id], limit: 1 })
      if (batches.isErr()) return err(batches.error)
      batch = batches.value[0] ?? null
      const [row] = await db
        .select({ payload: schema.ExportBatch.payload })
        .from(schema.ExportBatch)
        .where(
          and(
            eq(schema.ExportBatch.organizationId, organizationId),
            eq(schema.ExportBatch.id, live.id)
          )
        )
      payload = row?.payload ?? null
    }

    const members = batch ? batch.members : unbuilt.value
    const stored = await readMemberLines(
      db,
      organizationId,
      members.map((member) => member.glPostingId)
    )
    const names = new Map<string, string>()
    for (const line of stored) if (line.accountName) names.set(line.glAccountId, line.accountName)

    // A summary batch's payload is always a journal; anything else sums its members instead.
    const parsed = payload ? exportJournalSchema.safeParse(payload) : null
    const summed: LedgerSummaryLine[] = parsed?.success
      ? parsed.data.lines.map((line) => ({
          glAccountId: line.glAccountId,
          accountCode: line.accountCode ?? '',
          direction: line.direction,
          amountMinor: line.amountMinor,
        }))
      : sumSummaryLines(stored)

    return ok({
      batch,
      lines: summed.map((line) => ({ ...line, accountName: names.get(line.glAccountId) ?? null })),
      members,
      newMembers: batch ? unbuilt.value : [],
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Oldest first, so the name map ends on each account's newest snapshot. */
async function readMemberLines(db: Database, organizationId: string, glPostingIds: string[]) {
  if (glPostingIds.length === 0) return []
  return db
    .select({
      glAccountId: schema.GlPostingLine.glAccountId,
      accountCode: schema.GlPostingLine.accountCode,
      accountName: schema.GlPostingLine.accountName,
      direction: schema.GlPostingLine.direction,
      amountMinor: schema.GlPostingLine.amountMinor,
    })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        inArray(schema.GlPostingLine.glPostingId, glPostingIds)
      )
    )
    .orderBy(schema.GlPostingLine.createdAt)
}
