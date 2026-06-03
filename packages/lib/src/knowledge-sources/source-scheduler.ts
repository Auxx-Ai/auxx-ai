// packages/lib/src/knowledge-sources/source-scheduler.ts
// BullMQ job-scheduler registration for scheduled source re-syncs. Mirrors
// AgentTriggerService.syncSchedulers() — register on lifecycle (create/update/
// pause/delete), trust Redis persistence (no boot reconcile). A scheduled fire
// enqueues the SAME `source-sync` job as a manual Sync now, so there is no new
// worker logic. See plans/kb/sources/phase-3-scheduling.md.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, ne } from 'drizzle-orm'
import { getQueue, Queues } from '../jobs/queues'
import { convertToCronPattern, type ScheduledTriggerConfig } from '../workflows/cron-pattern'
import type { KnowledgeSourceRow } from './sinks/types'

const logger = createScopedLogger('source-scheduler')

const schedulerId = (sourceId: string) => `source-sync-${sourceId}`

/** A scheduled source's `scheduleConfig` is a ScheduledTriggerConfig (typed at the boundary). */
function scheduleConfigOf(source: KnowledgeSourceRow): ScheduledTriggerConfig | null {
  return (source.scheduleConfig as ScheduledTriggerConfig | null) ?? null
}

/**
 * Register or remove this source's scheduler to match its current state. Active iff
 * `syncBehavior === 'scheduled'`, not paused, and a schedule is configured. Idempotent:
 * an upsert with the same id replaces the pattern (no duplicate fires).
 */
export async function syncSourceScheduler(source: KnowledgeSourceRow): Promise<void> {
  const queue = getQueue(Queues.knowledgeSourceQueue)
  const config = scheduleConfigOf(source)
  const active = source.syncBehavior === 'scheduled' && source.status !== 'paused' && !!config

  if (!active || !config) {
    await removeSourceScheduler(source.id)
    return
  }

  try {
    const pattern = convertToCronPattern(config)
    await queue.upsertJobScheduler(
      schedulerId(source.id),
      { pattern, tz: config.timezone },
      {
        name: 'source-sync',
        data: {
          type: 'source-sync',
          sourceId: source.id,
          organizationId: source.organizationId,
        },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      }
    )
    logger.info('Upserted source-sync scheduler', { sourceId: source.id, pattern })
  } catch (error) {
    // Surface a bad cadence to the caller (tRPC validation) instead of silently
    // leaving the source unscheduled.
    logger.warn('Failed to upsert source-sync scheduler', {
      sourceId: source.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Re-register every scheduled source's BullMQ job scheduler. Optional hardening for a
 * cleared Redis — agents/workflows trust persistence and don't reconcile, but a source
 * schedule lost on a Redis flush would silently stop firing. Idempotent (upsert by the
 * same id), so it's safe to run on every worker boot. A bad cadence on one source is
 * logged and skipped — it never aborts the whole reconcile. Call from `setupSchedules()`.
 */
export async function reconcileSourceSchedulers(db: Database): Promise<void> {
  const sources = await db.query.KnowledgeSource.findMany({
    where: and(
      eq(schema.KnowledgeSource.syncBehavior, 'scheduled'),
      ne(schema.KnowledgeSource.status, 'paused')
    ),
  })

  let registered = 0
  for (const source of sources) {
    try {
      await syncSourceScheduler(source)
      registered += 1
    } catch (error) {
      logger.warn('Skipped source during scheduler reconcile', {
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('Reconciled source-sync schedulers', { registered, total: sources.length })
}

/** Remove this source's scheduler if present (safe to call when none exists). */
export async function removeSourceScheduler(sourceId: string): Promise<void> {
  const queue = getQueue(Queues.knowledgeSourceQueue)
  try {
    await queue.removeJobScheduler(schedulerId(sourceId))
  } catch (error) {
    logger.warn('Failed to remove source-sync scheduler', {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
