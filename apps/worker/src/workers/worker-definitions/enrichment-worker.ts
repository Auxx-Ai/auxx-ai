// apps/worker/src/workers/worker-definitions/enrichment-worker.ts

import { enrichCompanyJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:enrichment')

// The key MUST equal `ENRICH_COMPANY_JOB_NAME` — `enqueueCompanyEnrichment` adds the job
// under that name and `createJobHandler` dispatches on it.
const enrichmentJobMappings = {
  enrichCompanyJob,
}

/**
 * Starts the record-enrichment worker (plans/company/v4-enrichment-doors.md §6 L5).
 *
 * Its OWN queue, deliberately. Every job is an outbound HTTP fetch of a third-party
 * homepage plus a logo, up to 13s worst case, and the four enrichment doors mean a bulk
 * import can enqueue hundreds at once. Run inline on the events worker (which is where it
 * lived while `created` was the only door) a 315-company import occupied one slot for
 * nearly an hour and head-of-line blocked every unrelated event behind it.
 *
 * Concurrency 3 is the global cap on simultaneous outbound fetches. The per-org hourly
 * budget in `companies/enrichment/guards.ts` is the binding constraint above that.
 */
export function startEnrichmentWorker() {
  logger.info(`Starting worker for queue: ${Queues.enrichmentQueue}`)

  return createWorker(Queues.enrichmentQueue, enrichmentJobMappings, { concurrency: 3 })
}
