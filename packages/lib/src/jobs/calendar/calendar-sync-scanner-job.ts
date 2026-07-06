// packages/lib/src/jobs/calendar/calendar-sync-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'

/**
 * Logger for the calendar sync scanner.
 */
const logger = createScopedLogger('job:calendar-sync-scanner')

/**
 * Minimum gap between calendar sync attempts for the same integration.
 */
const CALENDAR_SYNC_COOLDOWN_MS = 4 * 60 * 1000

/**
 * Scanner job payload.
 */
export interface CalendarSyncScannerJobData {
  dryRun?: boolean
}

/**
 * Scan enabled Google integrations and enqueue calendar sync jobs.
 */
export const calendarSyncScannerJob = async (ctx: JobContext<CalendarSyncScannerJobData>) => {
  const job = ctx.job
  const { dryRun = false } = job.data
  const now = new Date()
  const queue = getQueue(Queues.calendarSyncQueue)

  logger.info('Starting calendar sync scanner', {
    dryRun,
    jobId: job.id,
  })

  const integrations = await db
    .select({
      id: schema.Integration.id,
      organizationId: schema.Integration.organizationId,
      metadata: schema.Integration.metadata,
      systemUserId: schema.Organization.systemUserId,
      createdById: schema.Organization.createdById,
    })
    .from(schema.Integration)
    .innerJoin(schema.Organization, eq(schema.Organization.id, schema.Integration.organizationId))
    .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
    .where(
      and(
        eq(schema.Integration.enabled, true),
        eq(schema.Integration.provider, 'google'),
        isNull(schema.Integration.deletedAt),
        // jsonb boolean comparison — matches readCalendarMetadata's `=== true`
        // exactly (missing key or a "true" string both fail), so the scan only
        // returns calendar-enabled integrations instead of every Google one.
        sql`${schema.Integration.metadata} -> 'calendarSyncEnabled' = 'true'::jsonb`,
        or(isNull(schema.Credential.requiresReauth), eq(schema.Credential.requiresReauth, false))
      )
    )

  let enqueued = 0

  for (const integration of integrations) {
    const metadata = readCalendarMetadata(integration.metadata)

    // Cooldown stays in memory: casting a malformed metadata timestamp in SQL
    // would abort the whole scan; here it just skips the row.
    if (metadata.lastCalendarSyncAt) {
      const lastSyncAt = new Date(metadata.lastCalendarSyncAt)
      if (now.getTime() - lastSyncAt.getTime() < CALENDAR_SYNC_COOLDOWN_MS) {
        continue
      }
    }

    const userId = integration.systemUserId ?? integration.createdById
    if (!userId) {
      logger.warn('Skipping calendar sync because no org sync actor could be resolved', {
        integrationId: integration.id,
        organizationId: integration.organizationId,
      })
      continue
    }

    if (!dryRun) {
      await queue.add(
        'calendarSyncJob',
        {
          integrationId: integration.id,
          organizationId: integration.organizationId,
          userId,
        },
        {
          jobId: `calendar-sync-${integration.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        }
      )
    }

    enqueued++
  }

  logger.info('Completed calendar sync scanner', {
    scanned: integrations.length,
    enqueued,
  })

  return {
    scanned: integrations.length,
    enqueued,
  }
}

/**
 * Read the calendar-specific metadata stored on an integration.
 * (`calendarSyncEnabled` is filtered in SQL by the scan query.)
 */
function readCalendarMetadata(metadata: unknown): {
  lastCalendarSyncAt: string | null
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { lastCalendarSyncAt: null }
  }

  const value = metadata as Record<string, unknown>
  return {
    lastCalendarSyncAt:
      typeof value.lastCalendarSyncAt === 'string' ? value.lastCalendarSyncAt : null,
  }
}
