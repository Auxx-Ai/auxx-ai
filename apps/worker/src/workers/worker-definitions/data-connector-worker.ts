// apps/worker/src/workers/worker-definitions/data-connector-worker.ts
// BullMQ worker for Queues.dataConnectorQueue. A "Sync now" / scheduled fire starts
// a CHAIN of short backfill slices (startConnectorSync); each slice job advances one
// stream and re-enqueues the next (runBackfillSlice). Chained slices keep every job
// well under the lock, survive crashes (cursor checkpointed per slice), and never hog
// the worker. The orchestration lives in @auxx/lib; these handlers are thin shims.

import { database as db } from '@auxx/database'
import {
  type BackfillSliceJobData,
  runBackfillSlice,
  runConnectorTeardownSlice,
  SLICE_LOCK_DURATION_MS,
  startConnectorSync,
  type TeardownSliceJobData,
} from '@auxx/lib/data-connectors'
import type { JobContext } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:data-connector')

interface DataConnectorSyncJobData {
  type: 'data-connector-sync'
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
  /** Trial-sync §4.1 per-stream sample cap — set ⇒ a SAMPLE run that parks for review. */
  sampleLimit?: number
}

/** "Sync now" / scheduled fire → start the resumable backfill chain. */
async function handleDataConnectorSync(ctx: JobContext<DataConnectorSyncJobData>) {
  const { connectorId, organizationId, trigger, sampleLimit } = ctx.data
  logger.info('Starting data connector backfill chain', {
    connectorId,
    organizationId,
    trigger,
    sampleLimit,
  })
  await startConnectorSync(db, organizationId, connectorId, { trigger, sampleLimit })
}

interface DataConnectorSweepJobData {
  type: 'data-connector-sweep'
  connectorId: string
  organizationId: string
  trigger?: 'sweep'
}

/** Nightly delete-reconciliation sweep (Step 8C) → a full reconciling re-crawl. */
async function handleDataConnectorSweep(ctx: JobContext<DataConnectorSweepJobData>) {
  const { connectorId, organizationId } = ctx.data
  logger.info('Starting data connector delete sweep', { connectorId, organizationId })
  await startConnectorSync(db, organizationId, connectorId, { trigger: 'sweep' })
}

/** One slice of a backfill chain → advance a stream + re-enqueue the next slice. */
async function handleBackfillSlice(ctx: JobContext<BackfillSliceJobData>) {
  const { connectorId, organizationId, streamId, runId } = ctx.data
  await runBackfillSlice(db, { connectorId, organizationId, streamId, runId }, ctx.signal)
}

/**
 * One slice of a connector TEARDOWN → remove the next batch of minted records
 * and re-enqueue, or finalize and drop the connector row when nothing is left.
 * Same continuation shape as a backfill slice, for the same reason: a real
 * connector holds tens of thousands of records and no single job may own that.
 */
async function handleTeardownSlice(ctx: JobContext<TeardownSliceJobData>) {
  const { connectorId, organizationId, behavior } = ctx.data
  const outcome = await runConnectorTeardownSlice(db, ctx.data)
  logger.info('Teardown slice done', { connectorId, organizationId, behavior, ...outcome })
}

const jobMappings = {
  'data-connector-sync': handleDataConnectorSync,
  'data-connector-sweep': handleDataConnectorSweep,
  'data-connector-backfill-slice': handleBackfillSlice,
  'data-connector-teardown': handleTeardownSlice,
}

export function startDataConnectorWorker() {
  return createWorker(Queues.dataConnectorQueue, jobMappings, {
    concurrency: 2,
    enableCancellation: true,
    // Lock must outlast a slice's active-work budget (SLICE_BUDGET.maxMs) with margin
    // — slices never sleep on a throttle, so 2–3× the budget is safe.
    lockDuration: SLICE_LOCK_DURATION_MS,
  })
}
