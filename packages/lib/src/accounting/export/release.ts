// packages/lib/src/accounting/export/release.ts
// Gate 2's one verb: a held batch is handed to the worker once, by a person.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { jobId } from '../../jobs/job-id'

const logger = createScopedLogger('postings:export-release')

/** How long a release will wait on the queue before leaving it to the sweep. */
const ENQUEUE_TIMEOUT_MS = 2_000

export interface ReleaseExportBatchesResult {
  released: string[]
  /** Batches that are not `ready` or `failed`, so there is nothing to release. */
  skipped: string[]
}

/**
 * Hand batches to the export worker without waiting on the provider.
 *
 * 🛑 It RELEASES and returns. A send is three to five sequential round trips to
 * a rate-limited third party and a bulk bar acts on forty rows at once, so doing
 * it inline is a request nobody holds open. `retryExportBatch` stays the
 * one-row door, precisely because a single row wants its refusal back in the
 * same breath.
 */
export async function releaseExportBatches(
  db: Database,
  input: { organizationId: string; batchIds: string[] }
): Promise<Result<ReleaseExportBatchesResult, Error>> {
  const { organizationId, batchIds } = input
  try {
    const rows = await db
      .select({ id: schema.ExportBatch.id, state: schema.ExportBatch.state })
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          inArray(schema.ExportBatch.id, batchIds)
        )
      )
    const released: string[] = []
    const skipped: string[] = []
    for (const row of rows) {
      if (row.state === 'ready' || row.state === 'failed') released.push(row.id)
      else skipped.push(row.id)
    }
    for (const batchId of released) await enqueueExportBatch({ organizationId, batchId })
    return ok({ released, skipped })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Put one batch on the queue.
 *
 * Losing the enqueue is survivable and deliberately not fatal: the batch row is
 * committed, and `sweepExportBatches` exists to find the ones nothing woke up
 * for. The queue is an optimisation on WHEN, never the only path - which is why
 * the wait is bounded: ioredis retries a refused connection forever rather than
 * failing, and an unbounded await here would hand the caller a new way to hang.
 */
export async function enqueueExportBatch(input: {
  organizationId: string
  batchId: string
}): Promise<void> {
  try {
    const { getQueue, Queues } = await import('../../jobs/queues')
    const queued = getQueue(Queues.exportBatchQueue)
      .add('export-batch', input, { jobId: jobId('export-batch', input.batchId) })
      .catch((error) => {
        logger.warn('Could not enqueue an export batch; the sweep will pick it up', {
          ...input,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    const result = await Promise.race([
      queued,
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), ENQUEUE_TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    if (result === expired)
      logger.warn('Enqueueing an export batch timed out; the sweep will pick it up', input)
  } catch (error) {
    logger.warn('Could not enqueue an export batch; the sweep will pick it up', {
      ...input,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
