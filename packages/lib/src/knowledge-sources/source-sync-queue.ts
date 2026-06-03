// packages/lib/src/knowledge-sources/source-sync-queue.ts

import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../jobs/queues'

const logger = createScopedLogger('source-sync-queue')

export interface SourceSyncJobData {
  type: 'source-sync'
  sourceId: string
  organizationId: string
}

/**
 * Enqueue a source re-sync. The jobId coalesces duplicate manual "Sync now"
 * clicks for the same source; scheduled fires (Phase 3) get distinct ids and
 * rely on the in-handler `status='syncing'` guard to avoid overlap.
 */
export async function enqueueSourceSync(data: {
  sourceId: string
  organizationId: string
}): Promise<void> {
  try {
    const queue = getQueue(Queues.knowledgeSourceQueue)
    await queue.add(
      'source-sync',
      { type: 'source-sync', sourceId: data.sourceId, organizationId: data.organizationId },
      // BullMQ rejects ':' in custom job ids — keep it hyphenated. Coalesces
      // duplicate manual "Sync now" clicks for the same source.
      { jobId: `source-sync-manual-${data.sourceId}` }
    )
  } catch (error) {
    logger.error('Failed to enqueue source sync job', {
      data,
      error: error instanceof Error ? error.message : error,
    })
  }
}
