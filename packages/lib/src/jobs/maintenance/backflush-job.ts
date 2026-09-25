// packages/lib/src/jobs/maintenance/backflush-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { periodKeyForDate } from '../../accounting/ledger/periods/periods'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { backflushBuilds } from '../../inventory/builds/backflush'
import { listOrganizationIdsBySetting } from '../../settings/read'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('backflush-job')

/** Absent: the nightly pass over every org with `inventory.backflush` on. Present: one org, one range (111 D24). */
export interface BackflushJobData {
  organizationId: string
  /** `YYYY-MM-DD` days in the org's book time zone, inclusive. */
  from: string
  to: string
  actorUserId?: string
}

/** The local day before `now` in `timeZone`, `YYYY-MM-DD`. */
export function yesterdayInZone(now: Date, timeZone: string): string {
  const today = periodKeyForDate(now, 'day', timeZone)
  const date = new Date(`${today}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

// TODO(mrp): once the plan run exists, schedule it after this job — the planner must read a ledger
// the backflush has already caught up.
export async function backflushJob(ctx: JobContext<BackflushJobData | undefined>): Promise<void> {
  if (ctx.data?.organizationId) {
    const { organizationId, from, to, actorUserId } = ctx.data
    const result = await backflushBuilds(database, organizationId, { from, to, actorUserId })
    if (result.isErr()) throw result.error
    logger.info('Backflush run finished', {
      jobId: ctx.jobId,
      organizationId,
      ...counts(result.value),
    })
    return
  }

  const organizations = await listOrganizationIdsBySetting('inventory.backflush', true)
  const now = new Date()
  for (const organizationId of organizations) {
    // One org's failure must not lose the others.
    try {
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const yesterday = yesterdayInZone(now, timeZone)
      const result = await backflushBuilds(database, organizationId, {
        from: yesterday,
        to: yesterday,
        now,
      })
      if (result.isErr()) throw result.error
      logger.info('Nightly backflush finished', { organizationId, ...counts(result.value) })
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

function counts(summary: {
  batchRun: number | null
  written: unknown[]
  leftInProgress: unknown[]
  failed: unknown[]
  failedDays: unknown[]
}) {
  return {
    batchRun: summary.batchRun,
    written: summary.written.length,
    leftInProgress: summary.leftInProgress.length,
    failed: summary.failed.length,
    failedDays: summary.failedDays.length,
  }
}

/** Queue one range for one org now (111 D24); a second request while one is queued collapses. */
export async function enqueueBackflushRun(
  organizationId: string,
  range: { from: string; to: string },
  actorUserId: string
): Promise<void> {
  // Lazy: the queue graph is server-only and heavy.
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../queues'),
    import('../queues/types'),
  ])
  const data: BackflushJobData = {
    organizationId,
    from: range.from,
    to: range.to,
    actorUserId,
  }
  // BullMQ rejects a custom jobId containing ':'.
  await getQueue(Queues.maintenanceQueue).add('backflushJob', data, {
    jobId: `backflush-${organizationId}`,
    removeOnComplete: true,
    removeOnFail: true,
  })
}
