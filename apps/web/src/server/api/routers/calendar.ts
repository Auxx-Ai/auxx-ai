// apps/web/src/server/api/routers/calendar.ts

import { schema } from '@auxx/database'
import { storeOAuthCsrfToken } from '@auxx/lib/cache'
import { requireAdminAccess } from '@auxx/lib/email'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { GoogleOAuthService } from '@auxx/lib/providers'
import {
  getCalendarEventById,
  getUpcomingMeetings,
  linkCalendarEventToMeeting,
  listCalendarEventParticipants,
  listCalendarEvents,
} from '@auxx/lib/recording/calendar'
import { TRPCError } from '@trpc/server'
import crypto from 'crypto'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type createTRPCContext, createTRPCRouter, notDemo, protectedProcedure } from '../trpc'

/**
 * Shared pagination input for calendar event listings.
 */
const listCalendarEventsInputSchema = z.object({
  from: z.date().optional(),
  to: z.date().optional(),
  limit: z.number().min(1).max(100).default(25).optional(),
  cursor: z.string().optional(),
})

/**
 * Calendar tRPC router.
 */
export const calendarRouter = createTRPCRouter({
  /**
   * List calendar events for the signed-in organization.
   */
  list: protectedProcedure.input(listCalendarEventsInputSchema).query(async ({ ctx, input }) => {
    const result = await listCalendarEvents(ctx.session.organizationId, input)
    return unwrapResult(result, 'Failed to list calendar events')
  }),

  /**
   * Return upcoming meetings for dashboard-style UI.
   */
  getUpcoming: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(5).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await getUpcomingMeetings(ctx.session.organizationId, {
        limit: input?.limit ?? 5,
      })
      return unwrapResult(result, 'Failed to load upcoming meetings')
    }),

  /**
   * Fetch one calendar event and its participant rows.
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const result = await getCalendarEventById(input.id, ctx.session.organizationId)
    return unwrapResult(result, 'Failed to load calendar event')
  }),

  /**
   * Fetch participant rows for a synced calendar event.
   */
  getParticipants: protectedProcedure
    .input(z.object({ calendarEventId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await listCalendarEventParticipants(
        input.calendarEventId,
        ctx.session.organizationId
      )
      return unwrapResult(result, 'Failed to load calendar participants')
    }),

  /**
   * Start the incremental Google OAuth flow for calendar.readonly.
   */
  enableSync: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .use(notDemo('enable calendar sync'))
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx.session.user.id, ctx.session.organizationId)

      const integration = await assertGoogleIntegration(
        ctx,
        input.integrationId,
        ctx.session.organizationId
      )
      const csrfToken = crypto.randomBytes(32).toString('hex')
      const authUrl = await GoogleOAuthService.getAuthUrl(
        ctx.session.organizationId,
        ctx.session.user.id,
        {
          purpose: 'calendar',
          integrationId: integration.id,
          redirectPath: `/app/settings/channels/${integration.id}?tab=settings`,
          csrfToken,
        }
      )

      await storeOAuthCsrfToken(ctx.session.user.id, csrfToken)

      return { authUrl }
    }),

  /**
   * Disable calendar sync for an existing Google integration.
   */
  disableSync: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .use(notDemo('disable calendar sync'))
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx.session.user.id, ctx.session.organizationId)

      const integration = await assertGoogleIntegration(
        ctx,
        input.integrationId,
        ctx.session.organizationId
      )

      await ctx.db
        .update(schema.Integration)
        .set({
          metadata: {
            ...readMetadata(integration.metadata),
            calendarSyncEnabled: false,
            calendarSyncToken: null,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integration.id))

      return { success: true }
    }),

  /**
   * Enqueue an immediate calendar sync for an integration.
   */
  triggerSync: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .use(notDemo('trigger calendar sync'))
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx.session.user.id, ctx.session.organizationId)

      const integration = await assertGoogleIntegration(
        ctx,
        input.integrationId,
        ctx.session.organizationId
      )

      const queue = getQueue(Queues.calendarSyncQueue)
      await queue.add(
        'calendarSyncJob',
        {
          integrationId: integration.id,
          organizationId: ctx.session.organizationId,
          userId: ctx.session.user.id,
        },
        {
          jobId: `calendar-sync-manual-${integration.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        }
      )

      return { success: true }
    }),

  /**
   * Return calendar sync status for Google integrations in the org.
   */
  getSyncStatus: protectedProcedure.query(async ({ ctx }) => {
    const integrations = await ctx.db
      .select({
        id: schema.Integration.id,
        email: schema.Integration.email,
        metadata: schema.Integration.metadata,
        requiresReauth: schema.Integration.requiresReauth,
        authStatus: schema.Integration.authStatus,
        lastAuthError: schema.Integration.lastAuthError,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, ctx.session.organizationId),
          eq(schema.Integration.provider, 'google')
        )
      )

    const [eventCountRow] = await ctx.db
      .select({ value: count() })
      .from(schema.CalendarEvent)
      .where(eq(schema.CalendarEvent.organizationId, ctx.session.organizationId))

    return {
      integrations: integrations.map((integration) => ({
        id: integration.id,
        email: integration.email,
        ...readCalendarMetadata(integration.metadata),
        requiresReauth: integration.requiresReauth,
        authStatus: integration.authStatus,
        lastAuthError: integration.lastAuthError,
      })),
      eventCount: eventCountRow?.value ?? 0,
    }
  }),

  /**
   * Manually link a calendar event to an existing Meeting record.
   */
  linkToMeeting: protectedProcedure
    .input(z.object({ calendarEventId: z.string(), entityInstanceId: z.string() }))
    .use(notDemo('link calendar event to meeting'))
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx.session.user.id, ctx.session.organizationId)

      const result = await linkCalendarEventToMeeting(
        input.calendarEventId,
        input.entityInstanceId,
        ctx.session.organizationId
      )

      return unwrapResult(result, 'Failed to link calendar event to meeting')
    }),

  /**
   * Manually link a synced meeting participant to a Contact record.
   */
  linkParticipantToContact: protectedProcedure
    .input(z.object({ participantId: z.string(), contactEntityInstanceId: z.string() }))
    .use(notDemo('link calendar participant to contact'))
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx.session.user.id, ctx.session.organizationId)

      await ctx.db
        .update(schema.MeetingParticipant)
        .set({
          contactEntityInstanceId: input.contactEntityInstanceId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.MeetingParticipant.id, input.participantId),
            eq(schema.MeetingParticipant.organizationId, ctx.session.organizationId)
          )
        )

      return { success: true }
    }),
})

/**
 * Assert that the requested integration is a Google integration in the current organization.
 */
async function assertGoogleIntegration(
  ctx: Pick<Awaited<ReturnType<typeof createTRPCContext>>, 'db'>,
  integrationId: string,
  organizationId: string
) {
  const [integration] = await ctx.db
    .select()
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.id, integrationId),
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, 'google')
      )
    )
    .limit(1)

  if (!integration) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Google integration not found',
    })
  }

  return integration
}

/**
 * Convert a neverthrow Result into a plain tRPC payload or throw a typed error.
 */
function unwrapResult<T>(result: unknown, message: string): T {
  const candidate = result as {
    isErr(): boolean
    error?: Error
    value?: T
  }

  if (candidate.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: message,
      cause: candidate.error,
    })
  }

  return candidate.value as T
}

/**
 * Normalize calendar sync metadata for UI responses.
 */
function readCalendarMetadata(metadata: unknown): {
  calendarSyncEnabled: boolean
  calendarSyncToken: string | null
  lastCalendarSyncAt: string | null
} {
  const value = readMetadata(metadata)
  return {
    calendarSyncEnabled: value.calendarSyncEnabled === true,
    calendarSyncToken: typeof value.calendarSyncToken === 'string' ? value.calendarSyncToken : null,
    lastCalendarSyncAt:
      typeof value.lastCalendarSyncAt === 'string' ? value.lastCalendarSyncAt : null,
  }
}

/**
 * Normalize arbitrary metadata values into a plain object record.
 */
function readMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return metadata as Record<string, unknown>
}
