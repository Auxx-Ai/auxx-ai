// apps/worker/src/workers/worker-definitions/provider-sync-worker.ts

import {
  PROVIDER_SYNC_JOB_NAME,
  PROVIDER_SYNC_SCHEDULED_JOB_NAME,
  providerSyncJob,
  providerSyncScheduledJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  [PROVIDER_SYNC_JOB_NAME]: providerSyncJob,
  // The cadence's fire (brief 55 §5.1): it resolves the range and enqueues the
  // job above, so a scheduled walk and a pressed one are the same walk.
  [PROVIDER_SYNC_SCHEDULED_JOB_NAME]: providerSyncScheduledJob,
}

/**
 * Inbound provider-ledger sync worker: one slice of the walk over the connected
 * provider's general ledger per job, re-enqueueing itself until the range is
 * exhausted (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §4.6).
 *
 * 🛑 Concurrency 1, and unlike `accounting-delivery-worker.ts` beside it that IS
 * a correctness cap. A delivery targets one journal and holds a lease on it; a
 * walk is org-scoped and singular - two of them would share one cursor and one
 * `accounting.providerSyncedThrough`, and the marker means "this range has been
 * read completely". A second walk advancing it over a month the first one has
 * not finished is the one direction that value must never be wrong.
 *
 * ⚠️ But `concurrency` is per worker PROCESS, so it is org-singular only while
 * there is one replica - true of `infra/worker.ts` today (one SST service, no
 * `scaling` block) and enforced nowhere. `assertNoOpenRun` in `queue.ts` is what
 * actually holds the invariant, and it must keep holding it at two replicas.
 *
 * 🔑 `registerAccountingProviders()` runs in `apps/worker/src/server.ts` before
 * `startWorkers()`, which covers this path as well as the posting ones. Without
 * it every org resolves to `NONE_ACCOUNTING_PROVIDER` and a fully connected book
 * refuses with "No accounting system is connected".
 */
export function startProviderSyncWorker() {
  return createWorker(Queues.providerSyncQueue, jobMappings, {
    concurrency: 1,
  })
}
