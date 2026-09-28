// packages/lib/src/jobs/maintenance/undo-backflush-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  failUndoBackflushRun,
  recordUndoBackflushRecovery,
} from '../../inventory/builds/undo-backflush-mutations'
import { listStaleUndoBackflushRuns } from '../../inventory/builds/undo-backflush-queries'
import {
  finalizeUndoBackflushRun,
  parseUndoCursor,
  publishUndoBackflushRunFailed,
  runUndoBackflushSlice,
  startUndoBackflushRun,
} from '../../inventory/builds/undo-backflush-run'
import { jobId } from '../job-id'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('undo-backflush-job')

/** One step of an undo run (plans/mrp/17 §8). */
export interface UndoBackflushJobData {
  organizationId: string
  runId: string
  step: 'slice' | 'finalize'
  /** The run's cursor when this slice was enqueued; a slice whose cursor moved on is a duplicate. */
  cursor?: string | null
}

/** A run with no heartbeat for this long lost its worker and its job. */
const STALE_AFTER_MS = 10 * 60_000
const MAX_RECOVERIES = 5
const STEP_ATTEMPTS = 3

export async function undoBackflushJob(
  ctx: JobContext<UndoBackflushJobData | undefined>
): Promise<void> {
  const data = ctx.data
  if (!data?.organizationId || !data.runId || !data.step) {
    logger.warn('Dropping an undo job with no run', { jobId: ctx.jobId })
    return
  }
  const { organizationId, runId } = data
  if (data.step === 'finalize') {
    const result = await finalizeUndoBackflushRun(database, organizationId, runId)
    if (result.isErr()) await failOrRetry(ctx, data, result.error)
    return
  }

  const result = await runUndoBackflushSlice(database, organizationId, runId, {
    expectedCursor: data.cursor ?? null,
  })
  if (result.isErr()) {
    await failOrRetry(ctx, data, result.error)
    return
  }
  const next = result.value
  if (!next) return
  await enqueueUndoBackflushStep(
    next.kind === 'slice'
      ? { organizationId, runId, step: 'slice', cursor: next.cursor }
      : { organizationId, runId, step: 'finalize' }
  )
}

/** Throw for BullMQ's retry, or on the last attempt fail the row so the panel stops waiting. */
async function failOrRetry(ctx: JobContext<unknown>, data: UndoBackflushJobData, error: Error) {
  const attempts = ctx.job?.opts?.attempts ?? 1
  if ((ctx.job?.attemptsMade ?? 0) + 1 < attempts) throw error
  logger.error('Undo run failed', {
    organizationId: data.organizationId,
    runId: data.runId,
    step: data.step,
    error: error.message,
  })
  await failUndoBackflushRun(database, data.runId, error.message)
  await publishUndoBackflushRunFailed(database, data.organizationId, data.runId)
}

/**
 * Claim an undo (every backflush run, or `runNumber` alone) and queue its first slice. Refused
 * with `ConflictError` while a backflush or undo run is live for the org.
 */
export async function enqueueUndoBackflushRun(
  organizationId: string,
  actorUserId: string,
  runNumber?: number
): Promise<{ runId: string }> {
  const started = await startUndoBackflushRun(database, organizationId, {
    actorUserId,
    runNumber,
  })
  if (started.isErr()) throw started.error
  const { runId } = started.value
  try {
    await enqueueUndoBackflushStep({ organizationId, runId, step: 'slice', cursor: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failUndoBackflushRun(database, runId, `The run could not be queued: ${message}`)
    throw error
  }
  return { runId }
}

/** Queue one step; the id is per cursor, so the chain's own successor is never swallowed. */
export async function enqueueUndoBackflushStep(data: UndoBackflushJobData): Promise<void> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../queues'),
    import('../queues/types'),
  ])
  const key = data.step === 'finalize' ? 'finalize' : (data.cursor ?? 'start')
  await getQueue(Queues.maintenanceQueue).add('undoBackflushJob', data, {
    jobId: jobId('backflush-undo', data.organizationId, data.runId, key),
    attempts: STEP_ATTEMPTS,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  })
}

/** Re-enqueue the next step of every stale undo run; fail one that keeps stalling. */
export async function recoverStaleUndoBackflushRuns(now = new Date()): Promise<number> {
  const stale = await listStaleUndoBackflushRuns(database, {
    before: new Date(now.getTime() - STALE_AFTER_MS),
    limit: 10,
  })
  for (const row of stale) {
    const meta = row.metadata
    try {
      if (meta.recoveries >= MAX_RECOVERIES) {
        await failUndoBackflushRun(database, row.id, 'The run stopped making progress')
        await publishUndoBackflushRunFailed(database, row.organizationId, row.id)
        continue
      }
      await recordUndoBackflushRecovery(database, row.id, meta.recoveries + 1)
      const done = parseUndoCursor(meta.cursor).runIndex >= meta.runNumbers.length
      logger.warn('Re-enqueuing a stale undo run', {
        organizationId: row.organizationId,
        runId: row.id,
        cursor: meta.cursor,
      })
      await enqueueUndoBackflushStep(
        done
          ? { organizationId: row.organizationId, runId: row.id, step: 'finalize' }
          : {
              organizationId: row.organizationId,
              runId: row.id,
              step: 'slice',
              cursor: meta.cursor,
            }
      )
    } catch (error) {
      logger.error('Could not recover a stale undo run', {
        organizationId: row.organizationId,
        runId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return stale.length
}
