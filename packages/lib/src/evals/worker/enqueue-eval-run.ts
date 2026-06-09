// packages/lib/src/evals/worker/enqueue-eval-run.ts

import { getQueue, Queues } from '../../jobs/queues'

export const EVAL_RUN_JOB_NAME = 'processEvalRun'

export interface EvalRunJobData {
  organizationId: string
  userId: string
  runId: string
}

/** Deterministic job id per run — a BullMQ retry of the same run reuses it. */
export function evalRunJobId(runId: string): string {
  return `eval-run-${runId}`
}

/**
 * Enqueue an already-`queued` run. The run row owns lifecycle state; the
 * deterministic `jobId` makes the enqueue idempotent so a duplicate enqueue can't
 * spawn a second worker for the same run. See conventions.md §7.
 */
export async function enqueueEvalRun(data: EvalRunJobData) {
  const queue = getQueue(Queues.evalRunQueue)
  return queue.add(EVAL_RUN_JOB_NAME, data, {
    jobId: evalRunJobId(data.runId),
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { count: 200 },
  })
}
