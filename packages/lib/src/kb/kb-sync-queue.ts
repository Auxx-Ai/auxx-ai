// packages/lib/src/kb/kb-sync-queue.ts

import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../jobs/queues'

const logger = createScopedLogger('kb-sync-queue')

export type KBSyncJobType = 'sync' | 'sync-managed' | 'unpublish' | 'delete' | 'metadata'

export interface KBSyncJobData {
  type: KBSyncJobType
  articleId: string
  kbId: string
  organizationId: string
}

/**
 * Enqueue a KB article sync operation. JobId pattern collapses duplicates
 * of the same op for the same article so rapid edits are coalesced.
 *
 * Doubles as the kbCatalog invalidation choke point: every mutation that
 * changes published-article state (publish/unpublish/archive/delete, aiEnabled
 * toggle, move/rename metadata sync, source-sink writes) already flows through
 * here, so the agent-prompt catalog recomputes on the same events.
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
  await invalidateKbCatalog(data.organizationId)
}

/**
 * Recompute the org's cached KB catalog (the agent-prompt article ToC).
 * Fired by `enqueueKBSync` for all published-content mutations; call directly
 * for catalog-visible changes that don't enqueue a sync (e.g. reorders).
 */
export async function invalidateKbCatalog(organizationId: string): Promise<void> {
  try {
    // Lazy import — keeps the cache barrel out of this module's static graph
    // (vitest mocks of queue-adjacent modules break on eager barrel imports).
    const { onCacheEvent } = await import('../cache')
    await onCacheEvent('article.changed', { orgId: organizationId })
  } catch (error) {
    logger.warn('Failed to invalidate kbCatalog', {
      organizationId,
      error: error instanceof Error ? error.message : error,
    })
  }
}
