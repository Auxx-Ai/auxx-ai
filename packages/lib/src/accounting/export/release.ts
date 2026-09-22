// packages/lib/src/accounting/export/release.ts
// Gate 2's one verb: a held batch is handed to the worker once, by a person.

import { randomUUID } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { jobId } from '../../jobs/job-id'
import type { ExportFailureItem } from './client'
import { readExportBatchBlockers } from './preflight'
import { EXPORT_BATCHES_PER_JOB } from './send-many'

const logger = createScopedLogger('postings:export-release')

/** How long a release will wait on the queue before leaving it to the sweep. */
const ENQUEUE_TIMEOUT_MS = 2_000

export interface ReleaseExportBatchesResult {
  /** Tags every `exportBatch:changed` frame this release causes; never stored (93 B2). */
  runId: string
  released: string[]
  /** Batches that are not `ready` or `failed`, so there is nothing to release. */
  skipped: string[]
  /** Batches the mapping table already refuses (89 D8); never enqueued. */
  blocked: Array<{ batchId: string; items: ExportFailureItem[] }>
}

/**
 * Hand batches to the export worker without waiting on the provider.
 *
 * 🛑 It RELEASES and returns: a bulk bar acts on forty rows at once against a
 * rate-limited third party, a request nobody holds open. The released ids ride
 * `export-batches` jobs of {@link EXPORT_BATCHES_PER_JOB} (93 D5); `retryExportBatch`
 * stays the one-row door, because a single row wants its refusal back in the same breath.
 */
export async function releaseExportBatches(
  db: Database,
  input: {
    organizationId: string
    batchIds: string[]
    /** A person's Retry: the send resets the sweep's attempt budget, as `retryExportBatch` does. */
    manual?: boolean
  }
): Promise<Result<ReleaseExportBatchesResult, Error>> {
  const { organizationId, batchIds, manual } = input
  try {
    const rows = await db
      .select({
        id: schema.ExportBatch.id,
        state: schema.ExportBatch.state,
        payload: schema.ExportBatch.payload,
      })
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          inArray(schema.ExportBatch.id, batchIds)
        )
      )
    const releasable: typeof rows = []
    const skipped: string[] = []
    for (const row of rows) {
      if (row.state === 'ready' || row.state === 'failed') releasable.push(row)
      else skipped.push(row.id)
    }

    const refused = await readExportBatchBlockers(db, organizationId, releasable)
    if (refused.isErr()) return err(refused.error)

    const released: string[] = []
    const blocked: ReleaseExportBatchesResult['blocked'] = []
    for (const row of releasable) {
      const items = refused.value.get(row.id)
      if (items && items.length > 0) blocked.push({ batchId: row.id, items })
      else released.push(row.id)
    }
    const runId = randomUUID()
    await enqueueReleased({
      organizationId,
      batchIds: released,
      runId,
      ...(manual ? { manual } : {}),
    })
    return ok({ runId, released, skipped, blocked })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

export interface ReleaseFailedBatchesNamingAccountResult {
  released: string[]
  /** Still naming an account nobody has mapped, so nothing was enqueued for them. */
  stillBlocked: string[]
}

/**
 * Re-release the `configuration` failures that named one account, now it is mapped.
 *
 * A mapping fixes every batch that named that account, not the one whose drawer
 * was open, so the Failed tab must not keep the rest as stale verdicts (89 D6,
 * reversed). `lease()` admits a non-manual send of a `failed` batch whatever
 * `attempts` says, so nothing here touches that column.
 */
export async function releaseFailedBatchesNamingAccount(
  db: Database,
  input: { organizationId: string; glAccountId: string }
): Promise<Result<ReleaseFailedBatchesNamingAccountResult, Error>> {
  const { organizationId, glAccountId } = input
  try {
    const rows = await db
      .select({ id: schema.ExportBatch.id, payload: schema.ExportBatch.payload })
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          eq(schema.ExportBatch.state, 'failed'),
          eq(schema.ExportBatch.failureClass, 'configuration'),
          sql`${schema.ExportBatch.failureItems} @> ${JSON.stringify([{ ref: glAccountId }])}::jsonb`
        )
      )
    if (rows.length === 0) return ok({ released: [], stillBlocked: [] })

    const refused = await readExportBatchBlockers(db, organizationId, rows)
    if (refused.isErr()) return err(refused.error)

    const released: string[] = []
    const stillBlocked: string[] = []
    for (const row of rows) {
      const items = refused.value.get(row.id)
      if (items && items.length > 0) stillBlocked.push(row.id)
      else released.push(row.id)
    }
    await enqueueReleased({ organizationId, batchIds: released, runId: randomUUID() })
    if (released.length > 0)
      logger.info('Mapping an account re-released the batches that named it', {
        organizationId,
        glAccountId,
        released: released.length,
        stillBlocked: stillBlocked.length,
      })
    return ok({ released, stillBlocked })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Chunk released ids into `export-batches` jobs, in the order they were released. */
async function enqueueReleased(input: {
  organizationId: string
  batchIds: string[]
  runId: string
  manual?: boolean
}): Promise<void> {
  const { batchIds, ...rest } = input
  for (let i = 0; i < batchIds.length; i += EXPORT_BATCHES_PER_JOB)
    await enqueueExportBatches({ ...rest, batchIds: batchIds.slice(i, i + EXPORT_BATCHES_PER_JOB) })
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
  runId?: string
  manual?: boolean
}): Promise<void> {
  await enqueueBounded(
    'exportBatchQueue',
    'export-batch',
    input,
    jobId('export-batch', input.batchId)
  )
}

/** Put one released set on the plural queue; survivable to lose, as {@link enqueueExportBatch} is. */
export async function enqueueExportBatches(input: {
  organizationId: string
  batchIds: string[]
  runId: string
  manual?: boolean
}): Promise<void> {
  // The run id and the first id name the chunk; one release never enqueues a chunk twice.
  const id = jobId('export-batches', input.runId, input.batchIds[0] ?? '')
  await enqueueBounded('exportBatchesQueue', 'export-batches', input, id)
}

async function enqueueBounded(
  queue: 'exportBatchQueue' | 'exportBatchesQueue',
  name: string,
  data: Record<string, unknown>,
  id: string
): Promise<void> {
  const context = { queue: name, organizationId: data.organizationId, jobId: id }
  try {
    const { getQueue, Queues } = await import('../../jobs/queues')
    const queued = getQueue(Queues[queue])
      .add(name, data, { jobId: id })
      .catch((error) => {
        logger.warn('Could not enqueue an export batch; the sweep will pick it up', {
          ...context,
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
      logger.warn('Enqueueing an export batch timed out; the sweep will pick it up', context)
  } catch (error) {
    logger.warn('Could not enqueue an export batch; the sweep will pick it up', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
