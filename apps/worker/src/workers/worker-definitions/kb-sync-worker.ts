// apps/worker/src/workers/worker-definitions/kb-sync-worker.ts

import { database as db } from '@auxx/database'
import type { JobContext } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import type { KBSyncJobData } from '@auxx/lib/kb/kb-sync-queue'
import { KBSyncService } from '@auxx/lib/kb/kb-sync-service'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:kb-sync')

async function handleKBSync(ctx: JobContext<KBSyncJobData>) {
  const { data } = ctx
  const { type, articleId, kbId, organizationId } = data

  logger.info('Processing KB sync job', { type, articleId, kbId, organizationId })

  const service = new KBSyncService({ db, organizationId })

  switch (type) {
    case 'sync':
      await service.syncArticle(articleId)
      break
    case 'unpublish':
      await service.unpublishArticle(articleId)
      break
    case 'delete':
      await service.deleteArticle(articleId, kbId)
      break
    case 'metadata':
      await service.updateArticleMetadata(articleId)
      break
    default: {
      const exhaustive: never = type
      throw new Error(`Unknown KB sync job type: ${exhaustive as string}`)
    }
  }
}

const jobMappings = {
  'kb-sync:sync': handleKBSync,
  'kb-sync:unpublish': handleKBSync,
  'kb-sync:delete': handleKBSync,
  'kb-sync:metadata': handleKBSync,
}

export function startKBSyncWorker() {
  return createWorker(Queues.kbSyncQueue, jobMappings, {
    concurrency: 4,
    enableCancellation: true,
  })
}
