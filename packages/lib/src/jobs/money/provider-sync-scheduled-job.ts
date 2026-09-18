// packages/lib/src/jobs/money/provider-sync-scheduled-job.ts
//
// One firing of the cadence (brief 55 §5.1, §5.4). It resolves the range and
// then goes through `enqueueProviderSync` - the SAME door the button uses - so
// nothing about a slice changes because a cron opened it.

import { createScopedLogger } from '@auxx/logger'
import { enqueueProviderSync, firstDayAfterMonth, providerSyncFloor } from '../../accounting/mirror'
import { ConflictError } from '../../errors'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { getOrganizationSetting } from '../../settings/settings-service'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:provider-sync-scheduled')

export { PROVIDER_SYNC_SCHEDULED_JOB_NAME } from '../../accounting/mirror'

export interface ProviderSyncScheduledJobData {
  organizationId: string
}

/**
 * Open a walk over the org's OPEN periods.
 *
 * **Never throws.** A refusal is the normal shape of a scheduled fire that lands
 * on a running walk, and a fire that cannot resolve a range is covered by the
 * next one; both would otherwise earn a BullMQ retry straight back into the
 * guard.
 */
export const providerSyncScheduledJob = async (
  ctx: JobContext<ProviderSyncScheduledJobData>
): Promise<void> => {
  const { organizationId } = ctx.data

  try {
    const [cutoffPeriod, bookTimeZone] = await Promise.all([
      readSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.cutoffPeriod),
      readSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.bookTimeZone),
    ])
    if (!cutoffPeriod) {
      logger.info('Skipping a scheduled provider sync: this org has no accounting cutoff', {
        organizationId,
      })
      return
    }

    // 🛑 An accounting date is a calendar day in the BOOKS' own zone. Read in
    // the server's and a fire just after midnight UTC asks for a day the books
    // have not reached, or misses the day they are on.
    const to = periodKeyForDate(new Date(), 'day', bookTimeZone ?? 'UTC')
    const from = await resolveOpenPeriodStart(organizationId, cutoffPeriod)

    const queued = await enqueueProviderSync({ organizationId, from, to, trigger: 'scheduled' })
    // A scheduled fire may drop silently - the next one is the recovery (§4.6.2).
    logger.info(
      queued ? 'Scheduled provider sync enqueued' : 'Scheduled provider sync not queued',
      {
        organizationId,
        from: from ?? 'floor',
        to,
      }
    )
  } catch (error) {
    if (error instanceof ConflictError) {
      // A walk is already going. The normal outcome of a cadence that fires
      // while a long backfill runs, and emphatically not a failure - a retry
      // would only walk back into the same guard.
      logger.info('Scheduled provider sync skipped: a run is already open', {
        organizationId,
        reason: error.message,
      })
      return
    }
    logger.error('Scheduled provider sync could not be opened', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Where the walk starts: the first day of the month after the period lock, or
 * the cutover floor when that is later (or when nothing is closed yet).
 *
 * 🛑 NOT "this month and last". That window cannot see the December adjusting
 * entry made in February, which is the case that motivated the feature (20 §7.2,
 * 55 §5.4). The close discipline is what bounds the window, and it is the only
 * bound that is correct by construction.
 *
 * @returns `undefined` for "everything the sync is allowed to see", which
 *   `planSyncChunks` resolves to the floor itself.
 */
async function resolveOpenPeriodStart(
  organizationId: string,
  cutoffPeriod: string
): Promise<string | undefined> {
  const { lockedThroughMonth } = await resolvePeriodLock(organizationId)
  if (!lockedThroughMonth) return undefined

  const afterLock = firstDayAfterMonth(lockedThroughMonth)
  if (!afterLock) return undefined

  // Below the floor is a refusal, never a clamp, inside `planSyncChunks`. A
  // lock at or before the cutoff is not an attempt to read the opening period,
  // it just means nothing since the cutover has been closed - so ask for the
  // floor rather than hand it a date it will refuse.
  const floor = providerSyncFloor(cutoffPeriod)
  if (floor.isErr() || afterLock <= floor.value) return undefined
  return afterLock
}

async function readSetting(
  organizationId: string,
  key: Parameters<typeof getOrganizationSetting>[0]['key']
): Promise<string | null> {
  const value = await getOrganizationSetting({ organizationId, key })
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
