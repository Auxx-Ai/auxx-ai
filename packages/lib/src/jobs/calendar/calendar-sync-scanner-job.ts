// packages/lib/src/jobs/calendar/calendar-sync-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, isNull } from 'drizzle-orm'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'

/**
 * Logger for the calendar sync scanner.
 */
const logger = createScopedLogger('job:calendar-sync-scanner')

/**
 * Auth statuses that require user intervention instead of more background sync attempts.
 */
const UNRECOVERABLE_AUTH_STATUSES = ['INVALID_GRANT', 'REVOKED_ACCESS', 'INSUFFICIENT_SCOPE']

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
export const calendarSyncScannerJob = async (job: Job<CalendarSyncScannerJobData>) => {
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
      authStatus: schema.Integration.authStatus,
      enabled: schema.Integration.enabled,
      systemUserId: schema.Organization.systemUserId,
      createdById: schema.Organization.createdById,
    })
    .from(schema.Integration)
    .innerJoin(schema.Organization, eq(schema.Organization.id, schema.Integration.organizationId))
    .where(
      and(
        eq(schema.Integration.enabled, true),
        eq(schema.Integration.provider, 'google'),
        isNull(schema.Integration.deletedAt)
      )
    )

  let enqueued = 0

  for (const integration of integrations) {
    if (UNRECOVERABLE_AUTH_STATUSES.includes(integration.authStatus ?? '')) {
      continue
    }

    const metadata = readCalendarMetadata(integration.metadata)
    if (!metadata.calendarSyncEnabled) {
      continue
    }

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
 */
function readCalendarMetadata(metadata: unknown): {
  calendarSyncEnabled: boolean
  lastCalendarSyncAt: string | null
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      calendarSyncEnabled: false,
      lastCalendarSyncAt: null,
    }
  }

  const value = metadata as Record<string, unknown>
  return {
    calendarSyncEnabled: value.calendarSyncEnabled === true,
    lastCalendarSyncAt:
      typeof value.lastCalendarSyncAt === 'string' ? value.lastCalendarSyncAt : null,
  }
}
