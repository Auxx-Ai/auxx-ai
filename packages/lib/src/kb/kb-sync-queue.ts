// packages/lib/src/kb/kb-sync-queue.ts

import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../jobs/queues'

const logger = createScopedLogger('kb-sync-queue')

export type KBSyncJobType = 'sync' | 'unpublish' | 'delete' | 'metadata'

export interface KBSyncJobData {
  type: KBSyncJobType
  articleId: string
  kbId: string
  organizationId: string
}

/**
 * Enqueue a KB article sync operation. JobId pattern collapses duplicates
 * of the same op for the same article so rapid edits are coalesced.
 */
export async function enqueueKBSync(data: KBSyncJobData): Promise<void> {
  try {
    const queue = getQueue(Queues.kbSyncQueue)
    await queue.add(`kb-sync:${data.type}`, data, {
      jobId: `kb-sync:${data.type}:${data.articleId}`,
    })
  } catch (error) {
    logger.error('Failed to enqueue KB sync job', {
      data,
      error: error instanceof Error ? error.message : error,
    })
  }
}
