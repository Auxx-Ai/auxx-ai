// apps/worker/src/workers/worker-definitions/knowledge-source-worker.ts

import { database as db } from '@auxx/database'
import type { JobContext } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { runSourceSync } from '@auxx/lib/knowledge-sources/run-source-sync'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:knowledge-source')

interface SourceSyncJobData {
  type: 'source-sync'
  sourceId: string
  organizationId: string
}

async function handleSourceSync(ctx: JobContext<SourceSyncJobData>) {
  const { sourceId, organizationId } = ctx.data
  logger.info('Processing source sync job', { sourceId, organizationId })
  await runSourceSync(db, organizationId, sourceId)
}

const jobMappings = {
  'source-sync': handleSourceSync,
}

export function startKnowledgeSourceWorker() {
  return createWorker(Queues.knowledgeSourceQueue, jobMappings, {
    concurrency: 2,
    enableCancellation: true,
  })
}
