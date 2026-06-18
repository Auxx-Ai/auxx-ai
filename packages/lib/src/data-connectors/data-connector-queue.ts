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
}

/**
 * Enqueue a connector sync. `jobId` coalesces duplicate manual "Sync now" clicks
 * for the same connector (BullMQ rejects ':' in custom ids — keep it hyphenated).
 */
export async function enqueueConnectorSync(data: {
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
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
