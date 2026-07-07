// packages/lib/src/jobs/calendar/calendar-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { AuthErrorHandler } from '../../providers/auth-error-handler'
import { syncCalendarForIntegration } from '../../recording/calendar'
import type { JobContext } from '../types'

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
export const calendarSyncJob = async (ctx: JobContext<CalendarSyncJobData>) => {
  const job = ctx.job
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
    // Missing calendar scope (e.g. the credential was re-minted through the
    // mail-only channel connect): the token works for Gmail, only Calendar is
    // ungranted. Marking the credential `requiresReauth` would wrongly stop
    // mail sync, and retrying can never succeed — turn calendar sync off for
    // this integration until the user re-grants calendar access (which sets
    // `calendarSyncEnabled` back to true).
    if (isInsufficientScopeError(result.error)) {
      await disableCalendarSync(integrationId)
      logger.warn('Calendar scope missing — calendar sync disabled until re-granted', {
        jobId: job.id,
        integrationId,
        error: result.error.message,
      })
      return { skipped: 'insufficient_scope' }
    }

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
    isInsufficientScopeError(error) ||
    message.includes('missing refresh token') ||
    message.includes('unauthorized')
  )
}

/**
 * The token is valid but lacks the calendar scope. Google phrases this as
 * "Insufficient Permission" (singular), "insufficientPermissions" (error
 * reason), or "insufficient authentication scopes" depending on the endpoint.
 */
function isInsufficientScopeError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('insufficient permission') ||
    message.includes('insufficientpermissions') ||
    message.includes('insufficient authentication scopes') ||
    message.includes('insufficient_scope')
  )
}

/** Flip `calendarSyncEnabled` off, preserving the rest of the metadata blob. */
async function disableCalendarSync(integrationId: string): Promise<void> {
  const [row] = await db
    .select({ metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)
  if (!row) return

  const base =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
  await db
    .update(schema.Integration)
    .set({
      metadata: { ...base, calendarSyncEnabled: false } as any,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))
}
