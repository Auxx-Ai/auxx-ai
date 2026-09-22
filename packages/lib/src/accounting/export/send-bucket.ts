// packages/lib/src/accounting/export/send-bucket.ts
// Send on a Summary row: build that one bucket if it has no live batch, then send
// it; Rebuild is rollback + build + send (plans/accounting/tasks/95-the-summary-is-the-row.md §3.2, D3).

import { type Database, schema } from '@auxx/database'
import { and, eq, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { buildExportBatches } from './build-batches'
import type { ExportBatchState, UnbuiltGroupKey } from './client'
import { type RollbackExportBatchResult, rollbackExportBatch } from './rollback'
import { type SendExportBatchResult, sendExportBatch } from './send'
import { summaryScope } from './summary-ctes'
import { readUnbuiltSummaryMembers } from './unbuilt-summary'

export interface SendSummaryBucketResult extends SendExportBatchResult {
  /** True when this call built the batch it sent. */
  built: boolean
}

export interface RebuildSummaryBucketResult {
  /** The new batch; the old one when the rollback refused. */
  batchId: string
  rollback: RollbackExportBatchResult
  /** Null when the rollback refused and nothing was rebuilt. */
  sent: SendSummaryBucketResult | null
}

interface BucketInput {
  organizationId: string
  key: UnbuiltGroupKey
}

/** The live batch on a bucket's key in this book - `ExportBatch_grain_key` allows one. */
async function readLiveBucketBatch(
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

async function sendLive(
  db: Database,
  organizationId: string,
  batch: { id: string; state: ExportBatchState },
  built: boolean
): Promise<Result<SendSummaryBucketResult, Error>> {
  if (batch.state === 'sent')
    return err(new ConflictError('This summary is already sent. Roll it back or rebuild it.'))
  // `failed` is a person's Retry: it resets the sweep's attempt budget.
  const sent = await sendExportBatch(db, {
    organizationId,
    batchId: batch.id,
    manual: batch.state === 'failed',
  })
  if (sent.isErr()) return err(sent.error)
  return ok({ ...sent.value, built })
}

/** Build the bucket when it has no live batch, then send (or retry) that batch. */
export async function sendSummaryBucket(
  db: Database,
  input: BucketInput
): Promise<Result<SendSummaryBucketResult, Error>> {
  const { organizationId, key } = input
  try {
    const scope = await summaryScope(db, { organizationId })
    if (!scope)
      return err(new UnprocessableEntityError('Summary export is off or no book is connected'))

    const live = await readLiveBucketBatch(db, organizationId, scope.bookId, key)
    if (live) return sendLive(db, organizationId, live, false)

    const members = await readUnbuiltSummaryMembers(db, { organizationId, group: key })
    if (members.isErr()) return err(members.error)
    if (members.value.length === 0)
      return err(new NotFoundError('This summary has nothing left to send'))
    const dates = members.value.map((member) => member.txnDate).sort()

    const built = await buildExportBatches(db, {
      organizationId,
      from: dates[0]!,
      to: dates[dates.length - 1]!,
      group: key,
    })
    if (built.isErr()) return err(built.error)

    // Re-read rather than trust `batchIds`: a racing builder's batch is the one to send.
    const batch = await readLiveBucketBatch(db, organizationId, scope.bookId, key)
    if (!batch)
      return err(
        new UnprocessableEntityError(
          'This summary has fewer than two non-zero lines, so no journal'
        )
      )
    return sendLive(db, organizationId, batch, built.value.batchIds.includes(batch.id))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** A sent bucket with postings since: roll back, rebuild from current detail, resend. Never from the sweep. */
export async function rebuildSummaryBucket(
  db: Database,
  input: BucketInput & { force?: boolean }
): Promise<Result<RebuildSummaryBucketResult, Error>> {
  const { organizationId, key } = input
  try {
    const scope = await summaryScope(db, { organizationId })
    if (!scope)
      return err(new UnprocessableEntityError('Summary export is off or no book is connected'))

    const live = await readLiveBucketBatch(db, organizationId, scope.bookId, key)
    if (!live || live.state !== 'sent')
      return err(new ConflictError('Only a sent summary can be rebuilt. Send it instead.'))

    const rollback = await rollbackExportBatch(db, {
      organizationId,
      batchId: live.id,
      force: input.force,
    })
    if (rollback.isErr()) return err(rollback.error)
    if (rollback.value.status === 'refused')
      return ok({ batchId: live.id, rollback: rollback.value, sent: null })

    const sent = await sendSummaryBucket(db, { organizationId, key })
    if (sent.isErr()) return err(sent.error)
    return ok({ batchId: sent.value.batchId, rollback: rollback.value, sent: sent.value })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
