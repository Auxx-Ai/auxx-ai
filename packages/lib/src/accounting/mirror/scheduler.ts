// packages/lib/src/accounting/mirror/scheduler.ts
//
// BullMQ job-scheduler registration for the inbound sync's SCHEDULED door
// (brief 55 §5.1). Mirrors `data-connectors/data-connector-scheduler.ts`, and
// the property that makes it cheap is that file's opening line: a scheduled
// fire enqueues the SAME job a manual Sync now does, so there is no separate
// worker logic. `reconcileProviderSyncSchedulers` runs on worker boot (Redis
// flush hardening; idempotent upsert).
//
// 🛑 No default cadence. An org with no `providerSync.schedule` value gets no
// scheduler - §5.4 gates switching one on behind reversal being driven once by
// hand and deferrals having a surfacing path, and neither is done. This is the
// mechanism, not the switch.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../../jobs/queues'
import {
  type ScheduledTriggerConfig as CronTriggerConfig,
  convertToCronPattern,
} from '../../workflows/cron-pattern'
import type { ProviderSyncScheduleConfig } from './client'
import { PROVIDER_SYNC_SCHEDULED_JOB_NAME } from './queue'
import {
  isSchedulableOrg,
  listOrgsWithAccountingProvider,
  readProviderSyncSchedule,
} from './scheduler-io'

const logger = createScopedLogger('postings:provider-sync:scheduler')

const schedulerId = (organizationId: string) => `provider-sync-${organizationId}`

/**
 * Narrow away `'off'`, which is "the button is the only door" and has no cron
 * pattern behind it. (A property check alone would not narrow the object - the
 * config is not a discriminated union.)
 */
function cronConfigOf(config: ProviderSyncScheduleConfig): CronTriggerConfig | null {
  const { triggerInterval } = config
  return triggerInterval === 'off' ? null : { ...config, triggerInterval }
}

/**
 * Register or remove this org's provider-sync scheduler to match its current
 * state. Idempotent - an upsert with the same id replaces the pattern.
 *
 * Call it after any write to `providerSync.schedule`.
 *
 * @throws whatever `convertToCronPattern` throws on a cadence it cannot turn
 *   into a pattern, so a settings write naming an impossible one is refused
 *   rather than silently registering nothing.
 */
export async function syncProviderSyncScheduler(organizationId: string): Promise<void> {
  const queue = getQueue(Queues.providerSyncQueue)
  const config = await readProviderSyncSchedule(organizationId)
  const cronConfig = config ? cronConfigOf(config) : null
  // The gate costs a cached provider resolve and one row, so it is only asked
  // once a cadence exists at all.
  const active = !!cronConfig && (await isSchedulableOrg(organizationId))

  if (!active || !cronConfig) {
    try {
      await queue.removeJobScheduler(schedulerId(organizationId))
    } catch {
      /* none registered */
    }
    return
  }

  try {
    const pattern = convertToCronPattern(cronConfig)
    await queue.upsertJobScheduler(
      schedulerId(organizationId),
      { pattern, tz: cronConfig.timezone },
      {
        name: PROVIDER_SYNC_SCHEDULED_JOB_NAME,
        // 🛑 The range is NOT resolved here. `to` is today in the book timezone
        // and `from` is the oldest open period; both move between registration
        // and every fire, so the fire resolves them (§5.4).
        data: { organizationId },
        // One attempt: a fire that cannot enqueue is covered by the next one,
        // and a retry would only walk back into `assertNoOpenRun`.
        opts: { attempts: 1 },
      }
    )
    logger.info('Upserted provider-sync scheduler', { organizationId, pattern })
  } catch (error) {
    logger.warn('Failed to upsert provider-sync scheduler', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/** Remove this org's scheduler if present (safe when none exists). */
export async function removeProviderSyncScheduler(organizationId: string): Promise<void> {
  try {
    await getQueue(Queues.providerSyncQueue).removeJobScheduler(schedulerId(organizationId))
  } catch (error) {
    logger.warn('Failed to remove provider-sync scheduler', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Re-register every eligible org's scheduler so a cleared Redis cannot silently
 * stop the cadence firing. Idempotent - safe on every worker boot. A bad cadence
 * on one org is logged and skipped, never fatal.
 *
 * ⚠️ Orgs with no cadence are still visited, and each costs a
 * `removeJobScheduler` against an id that is not there. That is the reference
 * implementation's shape, and it is what keeps a cadence switched off while the
 * worker was down from surviving in Redis.
 */
export async function reconcileProviderSyncSchedulers(db: Database): Promise<void> {
  const organizationIds = await listOrgsWithAccountingProvider(db)

  let registered = 0
  for (const organizationId of organizationIds) {
    try {
      await syncProviderSyncScheduler(organizationId)
      registered += 1
    } catch (error) {
      logger.warn('Skipped an organization during the provider-sync scheduler reconcile', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('Reconciled provider-sync schedulers', {
    registered,
    total: organizationIds.length,
  })
}
