// apps/worker/src/workers/worker-definitions/thumbnail-worker.ts

import { generateThumbnailJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  generateThumbnail: generateThumbnailJob,
}

export function startThumbnailWorker() {
  return createWorker(Queues.thumbnailQueue, jobMappings, {
    concurrency: 5, // Process up to 5 thumbnails concurrently
    limiter: {
      max: 100, // Max 100 jobs
      duration: 60000, // Per minute
    },
  })
}
