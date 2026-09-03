// packages/lib/src/data-connectors/data-connector-queue.ts
// BullMQ queue + enqueue helper for connector syncs. Mirrors the knowledge-source
// sync queue. The jobId coalesces duplicate manual "Sync now" clicks; scheduled
// fires get distinct ids and rely on the in-handler concurrency guard.

import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../jobs/queues'

const logger = createScopedLogger('data-connector-queue')

/** Job payload for a connector sync. */
export interface DataConnectorSyncJobData {
  type: 'data-connector-sync'
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
  /** Trial-sync §4.1 per-stream sample cap — set ⇒ a SAMPLE run that parks for review. */
  sampleLimit?: number
}

/** BullMQ job name for one backfill slice (the continuation-chain unit). */
export const BACKFILL_SLICE_JOB = 'data-connector-backfill-slice'

/** Job payload for one backfill slice — one stream's continuation chain (Step 4). */
export interface BackfillSliceJobData {
  type: typeof BACKFILL_SLICE_JOB
  connectorId: string
  organizationId: string
  /** The stream this slice advances (its own chain under the connector backfill). */
  streamId: string
  /** The connector-level run all this connector's slices fold into. */
  runId: string
}

/**
 * Enqueue the next backfill slice for a stream's continuation chain. No fixed
 * `jobId` — slices within a chain run sequentially (each enqueues the next after it
 * completes) and the per-connector claim blocks a second chain, so dedup isn't
 * needed. `delayMs` paces a throttled re-enqueue (H1) so it doesn't immediately
 * re-hit the rate limit.
 */
export async function enqueueBackfillSlice(
  data: Omit<BackfillSliceJobData, 'type'>,
  opts: { delayMs?: number } = {}
): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  await queue.add(
    BACKFILL_SLICE_JOB,
    { type: BACKFILL_SLICE_JOB, ...data } satisfies BackfillSliceJobData,
    { delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined }
  )
}

/** BullMQ job name for one teardown slice. */
export const TEARDOWN_SLICE_JOB = 'data-connector-teardown'

/** Job payload for one teardown slice (plans/records/bulk-delete-at-scale.md §7.1). */
export interface TeardownSliceJobData {
  type: typeof TEARDOWN_SLICE_JOB
  connectorId: string
  organizationId: string
  /** Who asked, so the records are removed as them. */
  userId: string
  /** `archive` soft-deletes the minted records; `delete` also tears down the schema. */
  behavior: 'archive' | 'delete'
}

/**
 * Enqueue a teardown slice.
 *
 * 🛑 **`dedupe` is for the FIRST slice only, and getting this wrong silently
 * kills the chain.** A fixed `jobId` coalesces a double-click on Remove, which
 * is what the opening enqueue wants. A CONTINUATION must never use one: the
 * slice enqueues its successor from inside its own handler, while its own job
 * is still active and still holding that id, so BullMQ returns the existing job
 * and adds nothing. The chain then runs exactly one slice and stops, leaving
 * the connector parked in `deleting` with most of its records intact — observed,
 * not theorised.
 *
 * Continuations need no dedup anyway: the chain is strictly sequential (a slice
 * enqueues the next only after its own work commits) and `DataConnector.status`
 * is the claim, so a stray duplicate stops on the status check. This is the same
 * choice {@link enqueueBackfillSlice} makes, for the same reason.
 */
export async function enqueueConnectorTeardown(
  data: Omit<TeardownSliceJobData, 'type'>,
  opts: { dedupe?: boolean } = {}
): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  await queue.add(
    TEARDOWN_SLICE_JOB,
    { type: TEARDOWN_SLICE_JOB, ...data } satisfies TeardownSliceJobData,
    // BullMQ rejects ':' in custom ids — keep it hyphenated.
    opts.dedupe ? { jobId: `data-connector-teardown-${data.connectorId}` } : {}
  )
}

/**
 * Enqueue a connector sync. `jobId` coalesces duplicate manual "Sync now" clicks
 * for the same connector (BullMQ rejects ':' in custom ids — keep it hyphenated).
 */
export async function enqueueConnectorSync(data: {
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
  /** Trial-sync §4.1 — a SAMPLE run caps each stream's backfill, then parks for review. */
  sampleLimit?: number
}): Promise<void> {
  try {
    const queue = getQueue(Queues.dataConnectorQueue)
    await queue.add(
      'data-connector-sync',
      {
        type: 'data-connector-sync',
        connectorId: data.connectorId,
        organizationId: data.organizationId,
        trigger: data.trigger ?? 'manual',
        sampleLimit: data.sampleLimit,
      },
      { jobId: `data-connector-sync-manual-${data.connectorId}` }
    )
  } catch (error) {
    logger.error('Failed to enqueue data connector sync job', {
      data,
      error: error instanceof Error ? error.message : error,
    })
  }
}
