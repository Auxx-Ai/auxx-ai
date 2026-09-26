// packages/lib/src/jobs/maintenance/backflush-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { periodKeyForDate } from '../../accounting/ledger/periods/periods'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { backflushBuilds } from '../../inventory/builds/backflush'
import {
  finalizeBackflushRun,
  publishBackflushRunFailed,
  runBackflushSlice,
  startBackflushRun,
} from '../../inventory/builds/backflush-run'
import {
  failBackflushRun,
  recordBackflushRecovery,
} from '../../inventory/builds/backflush-run-mutations'
import {
  findActiveBackflushRun,
  listStaleBackflushRuns,
} from '../../inventory/builds/backflush-run-queries'
import { listOrganizationIdsBySetting } from '../../settings/read'
import { jobId } from '../job-id'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('backflush-job')

/** Absent: the nightly pass over every org with `inventory.backflush` on. Present: one step of a run. */
export interface BackflushJobData {
  organizationId: string
  runId: string
  step: 'slice' | 'finalize'
  /** The run's cursor when this slice was enqueued; a slice whose cursor moved on is a duplicate. */
  cursor?: string | null
}

/** A run with no heartbeat for this long lost its worker and its job (the #2388 lesson). */
const STALE_AFTER_MS = 10 * 60_000
/** Re-enqueues before a stuck run is failed instead. */
const MAX_RECOVERIES = 5
const STEP_ATTEMPTS = 3

/** The local day before `now` in `timeZone`, `YYYY-MM-DD`. */
export function yesterdayInZone(now: Date, timeZone: string): string {
  const today = periodKeyForDate(now, 'day', timeZone)
  const date = new Date(`${today}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

// TODO(mrp): once the plan run exists, schedule it after this job — the planner must read a ledger
// the backflush has already caught up.
export async function backflushJob(
  ctx: JobContext<BackflushJobData | Record<string, unknown> | undefined>
): Promise<void> {
  const data = ctx.data as Partial<BackflushJobData> | undefined
  if (data?.runId && data.organizationId && data.step) {
    await runStep(ctx, data as BackflushJobData)
    return
  }
  if (data?.organizationId) {
    logger.warn('Dropping a backflush job with no run id', { jobId: ctx.jobId, ...data })
    return
  }
  await nightly(ctx)
}

async function runStep(ctx: JobContext<unknown>, data: BackflushJobData): Promise<void> {
  const { organizationId, runId } = data
  if (data.step === 'finalize') {
    const result = await finalizeBackflushRun(database, organizationId, runId)
    if (result.isErr()) await failOrRetry(ctx, data, result.error)
    return
  }

  const result = await runBackflushSlice(database, organizationId, runId, {
    expectedCursor: data.cursor ?? null,
  })
  if (result.isErr()) {
    await failOrRetry(ctx, data, result.error)
    return
  }
  const next = result.value
  if (!next) return
  await enqueueBackflushStep(
    next.kind === 'slice'
      ? { organizationId, runId, step: 'slice', cursor: next.cursor }
      : { organizationId, runId, step: 'finalize' }
  )
}

/** Throw for BullMQ's retry, or on the last attempt fail the row so the dialog stops waiting. */
async function failOrRetry(ctx: JobContext<unknown>, data: BackflushJobData, error: Error) {
  const attempts = ctx.job?.opts?.attempts ?? 1
  if ((ctx.job?.attemptsMade ?? 0) + 1 < attempts) throw error
  logger.error('Backflush run failed', {
    organizationId: data.organizationId,
    runId: data.runId,
    step: data.step,
    error: error.message,
  })
  await failBackflushRun(database, data.runId, error.message)
  await publishBackflushRunFailed(database, data.organizationId, data.runId)
}

async function nightly(ctx: JobContext<unknown>): Promise<void> {
  const organizations = await listOrganizationIdsBySetting('inventory.backflush', true)
  const now = new Date()
  for (const organizationId of organizations) {
    // One org's failure must not lose the others.
    try {
      // The run walks yesterday too; two walks at once would both build its shortfall.
      if (await findActiveBackflushRun(database, organizationId)) {
        logger.info('Nightly backflush skipped: a run is in progress', { organizationId })
        continue
      }
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const yesterday = yesterdayInZone(now, timeZone)
      const result = await backflushBuilds(database, organizationId, {
        from: yesterday,
        to: yesterday,
        now,
      })
      if (result.isErr()) throw result.error
      logger.info('Nightly backflush finished', {
        organizationId,
        batchRun: result.value.batchRun,
        written: result.value.written.length,
        failed: result.value.failed.length,
        failedDays: result.value.failedDays.length,
      })
    } catch (error) {
      logger.error('Nightly backflush failed for one organization', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('Nightly backflush page finished', {
    jobId: ctx.jobId,
    organizations: organizations.length,
  })
}

/** Claim a run over one range (refused while another is active) and queue its first slice. */
export async function enqueueBackflushRun(
  organizationId: string,
  range: { from: string; to: string },
  actorUserId: string
): Promise<{ runId: string }> {
  const started = await startBackflushRun(database, organizationId, { ...range, actorUserId })
  if (started.isErr()) throw started.error
  const { runId } = started.value
  try {
    await enqueueBackflushStep({ organizationId, runId, step: 'slice', cursor: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failBackflushRun(database, runId, `The run could not be queued: ${message}`)
    throw error
  }
  return { runId }
}

/** Queue one step; the id is per cursor, so the chain's own successor is never swallowed. */
export async function enqueueBackflushStep(data: BackflushJobData): Promise<void> {
  // Lazy: the queue graph is server-only and heavy.
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../queues'),
    import('../queues/types'),
  ])
  const key = data.step === 'finalize' ? 'finalize' : (data.cursor ?? 'start')
  await getQueue(Queues.maintenanceQueue).add('backflushJob', data, {
    jobId: jobId('backflush', data.organizationId, data.runId, key),
    attempts: STEP_ATTEMPTS,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  })
}

/** Re-enqueue the next step of every run whose heartbeat went stale; fail one that keeps stalling. */
export async function recoverStaleBackflushRuns(now = new Date()): Promise<number> {
  const stale = await listStaleBackflushRuns(database, {
    before: new Date(now.getTime() - STALE_AFTER_MS),
    limit: 10,
  })
  for (const row of stale) {
    const meta = row.metadata
    try {
      if (meta.recoveries >= MAX_RECOVERIES) {
        await failBackflushRun(database, row.id, 'The run stopped making progress')
        await publishBackflushRunFailed(database, row.organizationId, row.id)
        continue
      }
      await recordBackflushRecovery(database, row.id, meta.recoveries + 1)
      const done = meta.cursor != null && meta.cursor >= meta.to
      logger.warn('Re-enqueuing a stale backflush run', {
        organizationId: row.organizationId,
        runId: row.id,
        cursor: meta.cursor,
      })
      await enqueueBackflushStep(
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
      logger.error('Could not recover a stale backflush run', {
        organizationId: row.organizationId,
        runId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return stale.length
}
