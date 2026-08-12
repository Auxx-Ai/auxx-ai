// packages/lib/src/workflow-engine/nodes/dataset/embedding-wait.ts

import { createScopedLogger } from '@auxx/logger'
import { DATASET_NODE_CONSTANTS } from '../../constants/nodes/dataset'
import type { PauseReason } from '../../core/types'

const logger = createScopedLogger('dataset-embedding-wait')

/**
 * Bounds for the dataset node's "wait for embeddings" pause.
 *
 * The wait exists because embedding generation is a BullMQ flow: the dataset
 * node returns before a single vector exists, so a downstream knowledge
 * retrieval reading the same dataset races the embedding worker and silently
 * returns fewer (or zero) results.
 *
 * The timeout exists because that flow can stop making progress without ever
 * failing the paused run: a permanently-failing embedding batch leaves the
 * parent `finalize-document` job in `waiting-children` forever, and nothing
 * else would ever resume the workflow. A run that waits forever is strictly
 * worse than one that did not wait, so the wait is always bounded.
 *
 * The numbers themselves live in `constants/nodes/dataset.ts`, which the
 * builder panel reads too — the panel's help text has to promise exactly what
 * this file enforces.
 */
export const EMBEDDING_WAIT = DATASET_NODE_CONSTANTS.EMBEDDING_WAIT

/**
 * The `embeddingStatus` values that only exist once a wait has ended.
 *
 * `timeout` is this module's own: the two the finalize job reports are
 * `completed` and `failed`.
 */
export type EmbeddingWaitOutcome = 'completed' | 'failed' | 'timeout'

/**
 * Clamp a configured timeout into the supported range.
 *
 * An unset, non-finite or out-of-range value lands on the default rather than
 * failing the node — a bound variable that resolves to nonsense must not be
 * able to remove the bound on the wait.
 */
export function clampEmbeddingTimeoutMinutes(minutes: number | undefined): number {
  if (minutes === undefined || !Number.isFinite(minutes)) {
    return EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES
  }
  return Math.min(
    EMBEDDING_WAIT.MAX_TIMEOUT_MINUTES,
    Math.max(EMBEDDING_WAIT.MIN_TIMEOUT_MINUTES, Math.round(minutes))
  )
}

/**
 * Deterministic BullMQ job id for a dataset node's embedding timeout.
 *
 * Pure in `(workflowRunId, nodeId)` for the same reason
 * `buildWorkflowResumeJobId` is (see `../wait/resume-job-id.ts`): the finalize
 * job knows both, so it can cancel the exact pending timeout in O(1) without
 * anything being persisted to carry the id across.
 */
export function buildEmbeddingTimeoutJobId(workflowRunId: string, nodeId: string): string {
  return `dataset-embedding-timeout-${workflowRunId}-${nodeId}`
}

/**
 * The node output a timed-out wait resumes with.
 *
 * Continues on the node's normal `source` handle rather than `error`: the
 * document and its segments were written, the embeddings may still land later,
 * and the finalize job's own failure path resumes the same way. What the
 * workflow gets is an honest `embeddingStatus` to branch on — never a run that
 * sits in WAITING forever.
 */
function timeoutNodeOutput(params: {
  documentId: string
  timeoutMs: number
  originalNodeOutput?: Record<string, unknown>
}): Record<string, unknown> {
  const minutes = Math.round(params.timeoutMs / 60_000)
  return {
    ...params.originalNodeOutput,
    embeddingStatus: 'timeout' satisfies EmbeddingWaitOutcome,
    documentId: params.documentId,
    error: `Embeddings did not complete within ${minutes} minute(s)`,
    timedOutAt: new Date().toISOString(),
  }
}

/**
 * Schedule the delayed resume that ends a wait nothing else ended.
 *
 * Reuses the generic `resumeWorkflowJob` handler (the same one the wait node's
 * long delay uses) instead of introducing a job type, so no worker
 * registration is involved. The queue module is imported lazily to keep this
 * file cheap for the engine, which imports it only for
 * {@link embeddingResumeVariables}.
 */
export async function scheduleEmbeddingTimeout(params: {
  workflowRunId: string
  nodeId: string
  documentId: string
  timeoutMs: number
  originalNodeOutput?: Record<string, unknown>
}): Promise<void> {
  const { getQueue, Queues } = await import('../../../jobs/queues')
  const queue = getQueue(Queues.workflowDelayQueue)

  await queue.add(
    'resumeWorkflowJob',
    {
      workflowRunId: params.workflowRunId,
      resumeFromNodeId: params.nodeId,
      nodeOutput: timeoutNodeOutput(params),
    },
    {
      delay: params.timeoutMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      jobId: buildEmbeddingTimeoutJobId(params.workflowRunId, params.nodeId),
    }
  )

  logger.info('Scheduled embedding wait timeout', {
    workflowRunId: params.workflowRunId,
    nodeId: params.nodeId,
    documentId: params.documentId,
    timeoutMs: params.timeoutMs,
  })
}

/**
 * Drop a pending timeout because the embeddings resolved on their own.
 *
 * Must run BEFORE the completion path enqueues its own resume: once the run
 * leaves WAITING, a late timeout resume would fail
 * (`Cannot resume workflow in status …`) and retry three times for nothing.
 * Never throws — a workflow that finished correctly must not fail on cleanup.
 */
export async function cancelEmbeddingTimeout(
  workflowRunId: string,
  nodeId: string
): Promise<boolean> {
  const jobId = buildEmbeddingTimeoutJobId(workflowRunId, nodeId)
  try {
    const { getQueue, Queues } = await import('../../../jobs/queues')
    const job = await getQueue(Queues.workflowDelayQueue).getJob(jobId)
    if (!job) return false
    await job.remove()
    logger.debug('Cancelled embedding wait timeout', { jobId, workflowRunId, nodeId })
    return true
  } catch (error) {
    logger.warn('Failed to cancel embedding wait timeout', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** The dataset node output keys a resume payload is allowed to publish. */
const RESUMABLE_OUTPUT_KEYS = [
  'embeddingStatus',
  'segmentsEmbedded',
  'processingTimeMs',
  'completedAt',
  'error',
] as const

/**
 * The variables a `document_processing` resume makes addressable.
 *
 * A resumed node's processor is NEVER re-entered, so the pause-time write is
 * the last thing `DatasetProcessor` does — it leaves `<node>.embeddingStatus`
 * pinned at `processing` and `segmentsEmbedded` / `processingTimeMs` /
 * `completedAt` unwritten, whatever the embedding job later reported. This is
 * the same shape as `approvalDecisionVariablesFromResume`, and it is applied at
 * the same place, on the way back into the engine.
 *
 * Returns `null` for any other pause type, so it is inert for waits and
 * approvals.
 */
export function embeddingResumeVariables(
  pauseReason: PauseReason | undefined,
  nodeOutput: unknown
): Record<string, unknown> | null {
  if (pauseReason?.type !== 'document_processing') return null
  if (!nodeOutput || typeof nodeOutput !== 'object') return null

  const payload = nodeOutput as Record<string, unknown>
  const variables: Record<string, unknown> = {}
  for (const key of RESUMABLE_OUTPUT_KEYS) {
    if (payload[key] !== undefined) variables[key] = payload[key]
  }

  return Object.keys(variables).length > 0 ? variables : null
}
