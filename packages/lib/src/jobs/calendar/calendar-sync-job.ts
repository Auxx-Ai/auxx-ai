// packages/lib/src/jobs/calendar/calendar-sync-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { AuthErrorHandler } from '../../providers/auth-error-handler'
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
    // refreshTokens already routes through AuthErrorHandler — re-invoking here
    // would double-count consecutiveFailures. Only handle locally if the auth
    // failure surfaced from a direct API call (e.g. events.list 401) that
    // bypassed the refresh path.
    const alreadyHandled = result.error.message.includes('Failed to refresh Google access token')
    if (!alreadyHandled && isAuthError(result.error)) {
      const handler = new AuthErrorHandler('google', integrationId)
      await handler.handleAuthError(result.error, 'calendar_sync')
    }

    logger.error('Calendar sync job failed', {
      jobId: job.id,
      integrationId,
      error: result.error.message,
    })

    throw result.error
  }

  await AuthErrorHandler.resetFailureCounter(integrationId)

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
 * The AuthErrorHandler does the precise classification (invalid_rapt vs hard
 * invalid_grant vs insufficient scope); this is just the gate that decides
 * whether the error is even auth-shaped.
 */
function isAuthError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('invalid_grant') ||
    message.includes('invalid_rapt') ||
    message.includes('reauth related error') ||
    message.includes('insufficient permissions') ||
    message.includes('insufficient authentication scopes') ||
    message.includes('insufficient_scope') ||
    message.includes('missing refresh token') ||
    message.includes('unauthorized')
  )
}
