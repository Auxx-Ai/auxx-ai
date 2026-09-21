// packages/lib/src/accounting/export/queue-reads.ts
// What the export queue renders: batches for a month, each with the postings it
// rolls up. Same read in both modes (TARGET §6).

import { type Database, schema } from '@auxx/database'
import { and, asc, count, desc, eq, exists, gte, inArray, isNull, lt, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import { monthBounds } from '../ledger/periods/periods'
import type { PostingType } from '../ledger/types'
import type { ExportBatchState } from './client'

/** One posting inside a batch, in the words the row expands to. */
export interface ExportBatchMember {
  glPostingId: string
  postingType: PostingType
  docNumber: string | null
  txnDate: string
  totalMinor: number
}

export interface ExportBatchRow {
  id: string
  /** Which `ExternalAccountingBook` this batch was sent to - the queue's deep-link guard. */
  bookId: string
  state: ExportBatchState
  mode: 'transaction' | 'summary'
  avenue: string
  grainKey: string
  storeId: string | null
  railId: string | null
  currency: string
  objectType: string
  totalMinor: number
  docNumber: string | null
  attempts: number
  lastError: string | null
  providerObjectId: string | null
  nextAttemptAt: string | null
  sentAt: string | null
  members: ExportBatchMember[]
}

export interface ListExportBatchesInput {
  organizationId: string
  /** One accounting month, `'2026-09'`. Bounds the read by DETAIL date. */
  month?: string
  states?: ExportBatchState[]
  /** Only batches holding one of these postings as a live member - a card or drawer's read. */
  glPostingIds?: string[]
  limit?: number
  offset?: number
}

/** Rows per page when a caller does not say. */
export const EXPORT_BATCH_PAGE_SIZE = 50

/**
 * The queue, newest first, with every batch's member postings.
 *
 * Member postings are read in one second query rather than a join, so a summary
 * batch holding four hundred postings does not multiply its own row four
 * hundred times on the wire.
 */
export async function listExportBatches(
  db: Database,
  input: ListExportBatchesInput
): Promise<Result<ExportBatchRow[], Error>> {
  const { organizationId } = input
  try {
    if (input.month && !/^\d{4}-\d{2}$/.test(input.month))
      return err(new BadRequestError(`'${input.month}' is not an accounting month (YYYY-MM)`))
    const monthWindow = input.month ? monthBounds(input.month) : null

    if (input.glPostingIds && input.glPostingIds.length === 0) return ok([])

    const batches = await db
      .select()
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          input.states ? inArray(schema.ExportBatch.state, input.states) : undefined,
          input.glPostingIds
            ? exists(
                db
                  .select({ id: schema.ExportBatchPosting.id })
                  .from(schema.ExportBatchPosting)
                  .where(
                    and(
                      eq(schema.ExportBatchPosting.organizationId, organizationId),
                      eq(schema.ExportBatchPosting.batchId, schema.ExportBatch.id),
                      isNull(schema.ExportBatchPosting.withdrawnAt),
                      inArray(schema.ExportBatchPosting.glPostingId, input.glPostingIds)
                    )
                  )
              )
            : undefined
        )
      )
      .orderBy(desc(schema.ExportBatch.createdAt), asc(schema.ExportBatch.id))
      .limit(input.limit ?? EXPORT_BATCH_PAGE_SIZE)
      .offset(input.offset ?? 0)
    if (batches.length === 0) return ok([])

    const memberRows = await db
      .select({
        batchId: schema.ExportBatchPosting.batchId,
        glPostingId: schema.GlPosting.id,
        postingType: schema.GlPosting.postingType,
        docNumber: schema.GlPosting.docNumber,
        txnDate: schema.GlPosting.txnDate,
        totalMinor: schema.GlPosting.totalMinor,
      })
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
          inArray(
            schema.ExportBatchPosting.batchId,
            batches.map((batch) => batch.id)
          ),
          isNull(schema.ExportBatchPosting.withdrawnAt),
          // Half-open through `monthBounds`: `${month}-31` is not a date in a
          // short month and Postgres refuses the cast outright.
          ...(monthWindow
            ? [
                gte(schema.GlPosting.txnDate, monthWindow.first),
                lt(schema.GlPosting.txnDate, monthWindow.next),
              ]
            : [])
        )
      )
      .orderBy(asc(schema.GlPosting.txnDate))

    const byBatch = new Map<string, ExportBatchMember[]>()
    for (const row of memberRows) {
      const member: ExportBatchMember = {
        glPostingId: row.glPostingId,
        postingType: row.postingType,
        docNumber: row.docNumber,
        txnDate: row.txnDate,
        totalMinor: row.totalMinor,
      }
      const bucket = byBatch.get(row.batchId)
      if (bucket) bucket.push(member)
      else byBatch.set(row.batchId, [member])
    }

    return ok(
      batches
        // A month filter is a filter on the DETAIL, so a batch with no member in
        // that month is not in that month either.
        .filter((batch) => !input.month || byBatch.has(batch.id))
        .map((batch) => ({
          id: batch.id,
          bookId: batch.bookId,
          state: batch.state,
          mode: batch.mode,
          avenue: batch.avenue,
          grainKey: batch.grainKey,
          storeId: batch.storeId,
          railId: batch.railId,
          currency: batch.currency,
          objectType: batch.objectType,
          totalMinor: batch.totalMinor,
          docNumber: (batch.payload as { docNumber?: string }).docNumber ?? null,
          attempts: batch.attempts,
          lastError: batch.lastError,
          providerObjectId: batch.providerObjectId,
          nextAttemptAt: batch.nextAttemptAt?.toISOString() ?? null,
          sentAt: batch.sentAt?.toISOString() ?? null,
          members: byBatch.get(batch.id) ?? [],
        }))
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Every state's batch count, in one `GROUP BY` - the Outbox tab badges and the rail. */
export async function countExportBatchesByState(
  db: Database,
  organizationId: string
): Promise<Record<ExportBatchState, number>> {
  const rows = await db
    .select({ state: schema.ExportBatch.state, total: count() })
    .from(schema.ExportBatch)
    .where(eq(schema.ExportBatch.organizationId, organizationId))
    .groupBy(schema.ExportBatch.state)
  const counts: Record<ExportBatchState, number> = {
    ready: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    withdrawn: 0,
  }
  for (const row of rows) counts[row.state] = row.total
  return counts
}

/**
 * The live `ExportBatchPosting` rows for a set of postings or a set of batches.
 *
 * "Live" is `withdrawnAt IS NULL` - a withdrawn membership is history and must
 * never resolve as the batch a posting is in.
 */
export async function readLiveBatchMemberships(
  db: Database,
  organizationId: string,
  where: { glPostingIds?: readonly string[]; batchIds?: readonly string[] }
): Promise<Array<{ batchId: string; glPostingId: string }>> {
  const glPostingIds = where.glPostingIds ? [...new Set(where.glPostingIds)] : undefined
  const batchIds = where.batchIds ? [...new Set(where.batchIds)] : undefined
  if (glPostingIds?.length === 0 || batchIds?.length === 0) return []
  if (!glPostingIds && !batchIds) {
    throw new BadRequestError('readLiveBatchMemberships needs glPostingIds or batchIds')
  }

  return db
    .select({
      batchId: schema.ExportBatchPosting.batchId,
      glPostingId: schema.ExportBatchPosting.glPostingId,
    })
    .from(schema.ExportBatchPosting)
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        isNull(schema.ExportBatchPosting.withdrawnAt),
        ...(glPostingIds ? [inArray(schema.ExportBatchPosting.glPostingId, glPostingIds)] : []),
        ...(batchIds ? [inArray(schema.ExportBatchPosting.batchId, batchIds)] : [])
      )
    )
}
