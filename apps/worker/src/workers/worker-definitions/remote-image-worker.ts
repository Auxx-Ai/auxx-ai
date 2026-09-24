// apps/worker/src/workers/worker-definitions/remote-image-worker.ts

import { fetchRecordImageJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:remote-image')

// The key MUST equal `FETCH_RECORD_IMAGE_JOB_NAME` in `files/remote-image/enqueue.ts`.
const remoteImageJobMappings = {
  fetchRecordImageJob,
}

/** Connector image-URL fetches; the limiter caps our egress, the per-org budget lives in the job. */
export function startRemoteImageWorker() {
  logger.info(`Starting worker for queue: ${Queues.remoteImageQueue}`)

  return createWorker(Queues.remoteImageQueue, remoteImageJobMappings, {
    concurrency: 4,
    limiter: { max: 60, duration: 60_000 },
  })
}
