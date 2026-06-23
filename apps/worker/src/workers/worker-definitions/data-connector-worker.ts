// apps/worker/src/workers/worker-definitions/data-connector-worker.ts
// BullMQ worker for Queues.dataConnectorQueue. A "Sync now" / scheduled fire starts
// a CHAIN of short backfill slices (startConnectorSync); each slice job advances one
// stream and re-enqueues the next (runBackfillSlice). Chained slices keep every job
// well under the lock, survive crashes (cursor checkpointed per slice), and never hog
// the worker. The orchestration lives in @auxx/lib; these handlers are thin shims.

import { database as db } from '@auxx/database'
import {
  type BackfillSliceJobData,
  type ConnectorWebhookJobData,
  runBackfillSlice,
  runConnectorWebhook,
  SLICE_LOCK_DURATION_MS,
  startConnectorSync,
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
}

/** "Sync now" / scheduled fire → start the resumable backfill chain. */
async function handleDataConnectorSync(ctx: JobContext<DataConnectorSyncJobData>) {
  const { connectorId, organizationId, trigger } = ctx.data
  logger.info('Starting data connector backfill chain', { connectorId, organizationId, trigger })
  await startConnectorSync(db, organizationId, connectorId, { trigger })
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

/** One verified webhook delivery → apply its sink actions (Step 8A). */
async function handleConnectorWebhook(ctx: JobContext<ConnectorWebhookJobData>) {
  const { connectorId, organizationId, actions, eventId } = ctx.data
  await runConnectorWebhook(db, { connectorId, organizationId, actions, eventId })
}

const jobMappings = {
  'data-connector-sync': handleDataConnectorSync,
  'data-connector-sweep': handleDataConnectorSweep,
  'data-connector-backfill-slice': handleBackfillSlice,
  'data-connector-webhook': handleConnectorWebhook,
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
