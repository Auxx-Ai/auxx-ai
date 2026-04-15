// packages/lib/src/jobs/calendar/calendar-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { syncCalendarForIntegration } from '../../recording/calendar'

/**
 * Logger for per-integration calendar sync jobs.
 */
const logger = createScopedLogger('job:calendar-sync')

/**
 * Calendar sync job payload.
 */
export interface CalendarSyncJobData {
  integrationId: string
  organizationId: string
  userId: string
}

/**
 * Sync a single Google calendar integration.
 */
export const calendarSyncJob = async (jobOrCtx: Job<CalendarSyncJobData>) => {
  const job: Job<CalendarSyncJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { integrationId, organizationId, userId } = job.data

  logger.info('Starting calendar sync job', {
    jobId: job.id,
    integrationId,
    organizationId,
    userId,
  })

  const result = await syncCalendarForIntegration({
    integrationId,
    organizationId,
    userId,
  })

  if (result.isErr()) {
    if (isAuthError(result.error)) {
      await markCalendarSyncAuthFailure(integrationId, result.error)
    }

    logger.error('Calendar sync job failed', {
      jobId: job.id,
      integrationId,
      error: result.error.message,
    })

    throw result.error
  }

  logger.info('Calendar sync job completed', {
    jobId: job.id,
    integrationId,
    syncedEvents: result.value.syncedEvents,
    qualifyingEvents: result.value.qualifyingEvents,
    createdMeetings: result.value.createdMeetings,
    updatedMeetings: result.value.updatedMeetings,
  })

  return result.value
}

/**
 * Detect whether an error indicates authentication or consent failure.
 */
function isAuthError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('invalid_grant') ||
    message.includes('insufficient permissions') ||
    message.includes('insufficient authentication scopes') ||
    message.includes('missing refresh token') ||
    message.includes('unauthorized')
  )
}

/**
 * Mark the integration as needing re-auth and disable future calendar scans.
 */
async function markCalendarSyncAuthFailure(integrationId: string, error: Error): Promise<void> {
  const integration = await db.query.Integration.findFirst({
    where: (integrations, { eq }) => eq(integrations.id, integrationId),
  })

  if (!integration) {
    return
  }

  const metadata = readMetadata(integration.metadata)
  await db
    .update(schema.Integration)
    .set({
      metadata: {
        ...metadata,
        calendarSyncEnabled: false,
        calendarSyncToken: null,
      },
      requiresReauth: true,
      authStatus: error.message.toLowerCase().includes('insufficient')
        ? 'INSUFFICIENT_SCOPE'
        : 'INVALID_GRANT',
      lastAuthError: error.message,
      lastAuthErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))
}

/**
 * Normalize integration metadata into a mutable record.
 */
function readMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return metadata as Record<string, unknown>
}
