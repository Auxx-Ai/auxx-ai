// packages/lib/src/postings/export/queue-reads.ts
// What the export queue renders: batches for a month, each with the postings it
// rolls up. Same read in both modes (TARGET §6).

import { type Database, schema } from '@auxx/database'
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import type { PostingType } from '../types'
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
  /** One accounting month, `'2026-09'`. Bounds the read; it is unbounded without one. */
  month?: string
  state?: ExportBatchState
}

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

    const batches = await db
      .select()
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          input.state ? eq(schema.ExportBatch.state, input.state) : undefined
        )
      )
      .orderBy(desc(schema.ExportBatch.createdAt))
      .limit(500)
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
          input.month ? gte(schema.GlPosting.txnDate, `${input.month}-01`) : undefined,
          input.month ? lte(schema.GlPosting.txnDate, `${input.month}-31`) : undefined
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

/** How many batches are outstanding, for the ledger banner. */
export async function countOutstandingExportBatches(
  db: Database,
  organizationId: string
): Promise<Result<{ ready: number; failed: number }, Error>> {
  try {
    const rows = await db
      .select({ id: schema.ExportBatch.id, state: schema.ExportBatch.state })
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          inArray(schema.ExportBatch.state, ['ready', 'failed'])
        )
      )
    return ok({
      ready: rows.filter((row) => row.state === 'ready').length,
      failed: rows.filter((row) => row.state === 'failed').length,
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
