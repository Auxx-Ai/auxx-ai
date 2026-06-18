// packages/lib/src/data-connectors/data-connector-scheduler.ts
// BullMQ job-scheduler registration for scheduled connector syncs. Mirrors
// source-scheduler.ts. Active iff syncBehavior='scheduled' ∧ status≠'paused' ∧
// scheduleConfig present. A scheduled fire enqueues the SAME job as a manual Sync
// now, so there is no separate worker logic. `reconcileConnectorSchedulers` runs
// on worker boot (Redis-flush hardening; idempotent upsert).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, ne } from 'drizzle-orm'
import { getQueue, Queues } from '../jobs/queues'
import { convertToCronPattern, type ScheduledTriggerConfig } from '../workflows/cron-pattern'
import type { DataConnectorRow } from './service'

const logger = createScopedLogger('data-connector-scheduler')

const schedulerId = (connectorId: string) => `data-connector-sync-${connectorId}`

function scheduleConfigOf(connector: DataConnectorRow): ScheduledTriggerConfig | null {
  return (connector.scheduleConfig as ScheduledTriggerConfig | null) ?? null
}

/**
 * Register or remove this connector's scheduler to match its current state.
 * Idempotent — an upsert with the same id replaces the pattern (no duplicates).
 */
export async function syncConnectorScheduler(connector: DataConnectorRow): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  const config = scheduleConfigOf(connector)
  const active = connector.syncBehavior === 'scheduled' && connector.status !== 'paused' && !!config

  if (!active || !config) {
    await removeConnectorScheduler(connector.id)
    return
  }

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

/**
 * Re-register every scheduled connector's BullMQ job scheduler. Idempotent — safe
 * on every worker boot. A bad cadence on one connector is logged and skipped.
 */
export async function reconcileConnectorSchedulers(db: Database): Promise<void> {
  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.syncBehavior, 'scheduled'),
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

/** Remove this connector's scheduler if present (safe when none exists). */
export async function removeConnectorScheduler(connectorId: string): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  try {
    await queue.removeJobScheduler(schedulerId(connectorId))
  } catch (error) {
    logger.warn('Failed to remove data-connector-sync scheduler', {
      connectorId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
