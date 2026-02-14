// apps/worker/src/workers/worker-definitions/oauth2-refresh-worker.ts

import { oauth2TokenRefreshJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/queues/types'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  oauth2TokenRefreshJob,
}

/** Start OAuth2 refresh worker */
export function startOAuth2RefreshWorker() {
  return createWorker(Queues.oauth2RefreshQueue, jobMappings)
}
