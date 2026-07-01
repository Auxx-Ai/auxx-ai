// packages/lib/src/data-connectors/data-connector-scheduler.ts
// BullMQ job-scheduler registration for scheduled connector syncs. Mirrors
// source-scheduler.ts. Active iff syncBehavior='scheduled' ∧ status≠'paused' ∧
// scheduleConfig present. A scheduled fire enqueues the SAME job as a manual Sync
// now, so there is no separate worker logic. `reconcileConnectorSchedulers` runs
// on worker boot (Redis-flush hardening; idempotent upsert).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, inArray, ne } from 'drizzle-orm'
import { getQueue, Queues } from '../jobs/queues'
import { convertToCronPattern, type ScheduledTriggerConfig } from '../workflows/cron-pattern'
import type { DataConnectorRow } from './service'

const logger = createScopedLogger('data-connector-scheduler')

const schedulerId = (connectorId: string) => `data-connector-sync-${connectorId}`
const sweepSchedulerId = (connectorId: string) => `data-connector-sweep-${connectorId}`

/**
 * Nightly cron for the delete-reconciliation sweep (Step 8C). Fixed 03:00 — a sweep
 * is a full id-crawl, so we run it off-peak. Webhook connectors are the ones that
 * need it: they rely on push (at-least-once, can be late) and otherwise never do a
 * full reconciling crawl, so a missed delete event would linger. Snapshot connectors
 * already reconcile on every run; this is the safety net for the rest.
 */
const SWEEP_CRON = '0 3 * * *'

function scheduleConfigOf(connector: DataConnectorRow): ScheduledTriggerConfig | null {
  return (connector.scheduleConfig as ScheduledTriggerConfig | null) ?? null
}

/**
 * Register or remove this connector's SYNC scheduler to match its current state, then
 * unconditionally reconcile its SWEEP scheduler too (`syncConnectorSweepScheduler` —
 * independent of sync mode, own gate decides active/inactive; v9 §5 fix — a webhook
 * connector used to never reach this call because the old early-return here delegated
 * to `removeConnectorScheduler`, which tears down BOTH schedulers and returns before
 * the sweep call, so a webhook connector's sweep was silently never registered).
 * Idempotent — an upsert with the same id replaces the pattern (no duplicates).
 */
export async function syncConnectorScheduler(connector: DataConnectorRow): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  const config = scheduleConfigOf(connector)
  const active = connector.syncBehavior === 'scheduled' && connector.status !== 'paused' && !!config

  if (!active || !config) {
    try {
      await queue.removeJobScheduler(schedulerId(connector.id))
    } catch {
      /* none registered */
    }
  } else {
    try {
      const pattern = convertToCronPattern(config)
      await queue.upsertJobScheduler(
        schedulerId(connector.id),
        { pattern, tz: config.timezone },
        {
          name: 'data-connector-sync',
          data: {
            type: 'data-connector-sync',
            connectorId: connector.id,
            organizationId: connector.organizationId,
            trigger: 'scheduled',
          },
          opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        }
      )
      logger.info('Upserted data-connector-sync scheduler', { connectorId: connector.id, pattern })
    } catch (error) {
      logger.warn('Failed to upsert data-connector-sync scheduler', {
        connectorId: connector.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  await syncConnectorSweepScheduler(connector)
}

/**
 * Register or remove this connector's delete-reconciliation sweep (Step 8C). Active
 * iff the connector pushes via webhooks (`syncBehavior = 'webhook'`) and isn't paused
 * — those are the connectors that don't otherwise do a full reconciling crawl — AND
 * the cadence isn't explicitly turned off.
 *
 * Cadence (v9 §5): webhook mode repurposes `scheduleConfig` as the SWEEP cadence
 * (distinct from its 'scheduled'-mode meaning, the SYNC cadence — `syncConnectorScheduler`
 * gates its own registration on `syncBehavior === 'scheduled'`, so the two never
 * double-register off the same field). `null`/absent config ⇒ the default nightly
 * `SWEEP_CRON`; `{ triggerInterval: 'off' }` ⇒ no sweep at all (self-heal opted out).
 */
export async function syncConnectorSweepScheduler(connector: DataConnectorRow): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  const config = connector.syncBehavior === 'webhook' ? scheduleConfigOf(connector) : null
  const active =
    connector.syncBehavior === 'webhook' &&
    connector.status !== 'paused' &&
    config?.triggerInterval !== 'off'
  if (!active) {
    try {
      await queue.removeJobScheduler(sweepSchedulerId(connector.id))
    } catch {
      /* none registered */
    }
    return
  }
  try {
    const pattern =
      config && config.triggerInterval !== 'off' ? convertToCronPattern(config) : SWEEP_CRON
    await queue.upsertJobScheduler(
      sweepSchedulerId(connector.id),
      { pattern, tz: config?.timezone },
      {
        name: 'data-connector-sweep',
        data: {
          type: 'data-connector-sweep',
          connectorId: connector.id,
          organizationId: connector.organizationId,
          trigger: 'sweep',
        },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      }
    )
    logger.info('Upserted data-connector-sweep scheduler', { connectorId: connector.id, pattern })
  } catch (error) {
    logger.warn('Failed to upsert data-connector-sweep scheduler', {
      connectorId: connector.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Re-register every scheduled OR webhook connector's BullMQ job scheduler(s) —
 * `syncConnectorScheduler` reconciles both the sync and sweep schedulers per
 * connector, so routing webhook connectors through it too (v9 §5) re-registers their
 * custom sweep cadences on boot, not just scheduled connectors' sync cadences.
 * Idempotent — safe on every worker boot. A bad cadence on one connector is logged
 * and skipped.
 */
export async function reconcileConnectorSchedulers(db: Database): Promise<void> {
  const connectors = await db.query.DataConnector.findMany({
    where: and(
      inArray(schema.DataConnector.syncBehavior, ['scheduled', 'webhook']),
      ne(schema.DataConnector.status, 'paused')
    ),
  })

  let registered = 0
  for (const connector of connectors) {
    try {
      await syncConnectorScheduler(connector)
      registered += 1
    } catch (error) {
      logger.warn('Skipped connector during scheduler reconcile', {
        connectorId: connector.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('Reconciled data-connector-sync schedulers', {
    registered,
    total: connectors.length,
  })
}

/** Remove this connector's schedulers (sync + sweep) if present (safe when none exists). */
export async function removeConnectorScheduler(connectorId: string): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  for (const id of [schedulerId(connectorId), sweepSchedulerId(connectorId)]) {
    try {
      await queue.removeJobScheduler(id)
    } catch (error) {
      logger.warn('Failed to remove data-connector scheduler', {
        schedulerId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
