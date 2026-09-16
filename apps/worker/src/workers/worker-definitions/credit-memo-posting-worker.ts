// apps/worker/src/workers/worker-definitions/credit-memo-posting-worker.ts

import { CREDIT_MEMO_POSTING_JOB_NAME, creditMemoPostingJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  [CREDIT_MEMO_POSTING_JOB_NAME]: creditMemoPostingJob,
}

/**
 * Bulk credit memo posting worker (plans/accounting/tasks/done/28-how-your-books-post.md §3.1).
 *
 * Concurrency 1, and not as a throttle - the same cap `fulfillment-posting-worker.ts`
 * carries, for the same reason. One job posts every unposted channel memo in an
 * organization as one entry per issue day, and the period key of a day is claimed
 * by attempt number. Two runs side by side would read the same backlog, compute
 * the same attempt, and claim the same key, so the cap is part of the correctness
 * of the key. The `auto` lane's per-org `jobId` collapses repeat syncs into the
 * one job still queued; this caps what happens once they start.
 */
export function startCreditMemoPostingWorker() {
  return createWorker(Queues.creditMemoPostingQueue, jobMappings, {
    concurrency: 1,
  })
}
