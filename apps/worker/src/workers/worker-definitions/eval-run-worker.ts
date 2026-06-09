// apps/worker/src/workers/worker-definitions/eval-run-worker.ts

import {
  type EvalRunJobData,
  finalizeEvalRunOnTerminalFailure,
  processEvalRun,
} from '@auxx/lib/evals/worker'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:eval-run')

const evalRunJobMappings = {
  processEvalRun,
}

/**
 * Dedicated worker for agent-Simulation eval runs, bounded apart from the shared
 * `ai-agent` pool so a `runAll` batch can't starve live agent traffic. On terminal
 * failure (BullMQ retries exhausted) it finalizes the run as `error` so it never
 * lingers `running`. See plans/evals/phase-1-agent-simulation.md §1.9.
 */
export function startEvalRunWorker() {
  logger.info(`Starting worker for queue: ${Queues.evalRunQueue}`)

  const worker = createWorker(Queues.evalRunQueue, evalRunJobMappings, {
    // Eval runs are long (multi-turn LLM) and not latency-critical — keep the
    // pool small so they don't crowd out interactive work.
    concurrency: 3,
  })

  worker.on('failed', async (job, error) => {
    if (!job) return
    const maxAttempts = job.opts.attempts ?? 1
    // Fires on every failed attempt — only finalize once retries are exhausted.
    if (job.attemptsMade < maxAttempts) return

    const { runId } = job.data as EvalRunJobData
    logger.error('Eval run terminally failed — finalizing as error', {
      runId,
      error: error.message,
    })
    try {
      await finalizeEvalRunOnTerminalFailure({ runId, message: error.message })
    } catch (finalizeError) {
      logger.error('Failed to finalize terminally-failed eval run', {
        runId,
        error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
      })
    }
  })

  return worker
}
