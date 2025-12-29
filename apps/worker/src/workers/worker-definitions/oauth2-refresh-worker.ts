// apps/worker/src/workers/worker-definitions/oauth2-refresh-worker.ts

import { createWorker } from '../utils/createWorker'
import { Queues } from '@auxx/lib/queues/types'
import { oauth2TokenRefreshJob } from '@auxx/lib/jobs'

const jobMappings = {
  oauth2TokenRefreshJob,
}

/** Start OAuth2 refresh worker */
export function startOAuth2RefreshWorker() {
  return createWorker(Queues.oauth2RefreshQueue, jobMappings)
}
