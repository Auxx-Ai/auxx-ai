// apps/worker/src/workers/worker-definitions/data-connector-worker.ts
// BullMQ worker binding Queues.dataConnectorQueue → runDataConnectorSync. Mirrors
// the knowledge-source sync worker (concurrency 2, cancellable). Manual "Sync now"
// and scheduled fires both land here; the orchestrator's concurrency guard dedups.

import { database as db } from '@auxx/database'
import { runDataConnectorSync } from '@auxx/lib/data-connectors'
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

async function handleDataConnectorSync(ctx: JobContext<DataConnectorSyncJobData>) {
  const { connectorId, organizationId, trigger } = ctx.data
  logger.info('Processing data connector sync job', { connectorId, organizationId, trigger })
  await runDataConnectorSync(db, organizationId, connectorId, { trigger })
}

const jobMappings = {
  'data-connector-sync': handleDataConnectorSync,
}

export function startDataConnectorWorker() {
  return createWorker(Queues.dataConnectorQueue, jobMappings, {
    concurrency: 2,
    enableCancellation: true,
  })
}
