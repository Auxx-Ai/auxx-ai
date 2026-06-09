// packages/lib/src/evals/worker/process-eval-run.ts
//
// The BullMQ handler for one eval run: atomically claim → reconstruct + execute
// the Simulation → grade → finalize, checkpointing the trace and heartbeating
// between expensive boundaries, and publishing live events to Redis. The run row
// owns lifecycle state; terminal transitions are idempotent so a retry can't
// double-finalize or double-count a suite. See plans/evals/phase-1-agent-simulation.md §1.9.

import { createScopedLogger } from '@auxx/logger'
import type { AgentEvalTarget } from '@auxx/types/evals'
import { createCallModel } from '../../ai/agent-framework/llm-adapter'
import type { JobContext } from '../../jobs/types'
import { createResponseJudge, gradeAgentSimulation } from '../agent-grader'
import { checkpointEvalTrace, claimEvalRun, finalizeEvalRun, heartbeatEvalRun } from '../lifecycle'
import type { AgentRuntimeSnapshotV1 } from '../runtime-snapshot'
import { runAgentSimulation } from '../simulation/executor'
import type { AgentDefinitionSnapshotV1 } from '../snapshots'
import type { EvalRunJobData } from './enqueue-eval-run'
import { createEvalRunPublisher } from './publisher'

const logger = createScopedLogger('worker:eval-run')

const CHECKPOINT_BATCH = 10

export async function processEvalRun(ctx: JobContext<EvalRunJobData>): Promise<void> {
  const { organizationId, userId, runId } = ctx.data

  // 1. Atomically claim `queued|running → running` (bumps attempt). A terminal
  //    run returns null — never reprocess it.
  const claimed = await claimEvalRun({ runId })
  if (claimed.isErr()) {
    throw new Error(`Failed to claim eval run ${runId}: ${claimed.error.message}`)
  }
  const run = claimed.value
  if (!run) {
    logger.info('Eval run already terminal — skipping', { runId })
    return
  }

  // 2. Parse the immutable snapshots.
  const definitionSnapshot = run.definitionSnapshot as unknown as AgentDefinitionSnapshotV1
  const runtimeSnapshot = run.runtimeSnapshot as unknown as AgentRuntimeSnapshotV1
  const target: AgentEvalTarget = definitionSnapshot.case.target

  const publisher = createEvalRunPublisher(runId)
  const sessionId = `eval-run-${runId}`

  // Trace checkpoint buffer — Redis is live delivery; this is the durable cursor.
  const pending: Parameters<typeof checkpointEvalTrace>[0]['events'] = []
  let lastSequence = run.lastTraceSequence ?? 0
  const flush = async () => {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    await checkpointEvalTrace({ runId, events: batch, lastSequence })
  }

  // 3. Reconstruct + execute. `runAgentSimulation` never throws for a normal
  //    failure (it returns `result.error`); only infra faults escape to the
  //    terminal-failure handler.
  const result = await runAgentSimulation({
    organizationId,
    userId,
    sessionId,
    definitionSnapshot,
    runtimeSnapshot,
    signal: ctx.signal,
    onTrace: async (event) => {
      lastSequence = event.sequence
      pending.push(event)
      await publisher.publish({ type: 'trace', event })
      if (pending.length >= CHECKPOINT_BATCH) await flush()
    },
    onBoundary: async () => {
      ctx.throwIfCancelled()
      await heartbeatEvalRun({ runId })
    },
  })
  await flush()

  // 4. Grade. The response judge runs on the snapshotted grader model.
  const callModel = createCallModel({ organizationId, userId, source: 'eval', sourceId: sessionId })
  const judge = createResponseJudge({
    callModel,
    model: runtimeSnapshot.graderModel,
    signal: ctx.signal,
  })
  const grade = await gradeAgentSimulation({
    assertions: definitionSnapshot.case.assertions,
    scope: target.scope,
    result,
    judge,
  })

  // 5. Finalize transactionally (rolls suite counters up). Idempotent — a
  //    duplicate completion is a no-op.
  const finalized = await finalizeEvalRun({
    runId,
    status: grade.status,
    assertionResults: grade.assertionResults,
    trace: result.trace,
    ...(result.error ? { errorCode: result.error.code, error: result.error.message } : {}),
  })
  if (finalized.isErr()) {
    throw new Error(`Failed to finalize eval run ${runId}: ${finalized.error.message}`)
  }

  await publisher.publish({
    type: 'status',
    status: grade.status,
    assertionResults: grade.assertionResults,
  })
  await publisher.publish({ type: 'done' })

  logger.info('Eval run completed', {
    runId,
    status: grade.status,
    customerTurns: result.customerTurns,
    assertions: grade.assertionResults.length,
  })
}

/**
 * Terminal-failure handler for the worker's `failed` event — finalizes the run as
 * `error` ONLY after BullMQ retries are exhausted, so an intermediate attempt
 * never masquerades as a terminal error. Idempotent against a run that another
 * path already finalized.
 */
export async function finalizeEvalRunOnTerminalFailure(input: {
  runId: string
  message: string
}): Promise<void> {
  const finalized = await finalizeEvalRun({
    runId: input.runId,
    status: 'error',
    errorCode: 'EXECUTION_ERROR',
    error: input.message,
  })
  if (finalized.isErr()) {
    logger.error('Failed to finalize terminally-failed eval run', {
      runId: input.runId,
      error: finalized.error.message,
    })
    return
  }
  try {
    const { createEvalRunPublisher: makePublisher } = await import('./publisher')
    await makePublisher(input.runId).publish({ type: 'status', status: 'error' })
  } catch {
    // Best-effort live notice; the durable row is already `error`.
  }
}
