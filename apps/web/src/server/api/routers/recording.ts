// apps/web/src/server/api/routers/recording.ts

import { schema } from '@auxx/database'
import { createMediaAssetService } from '@auxx/lib/files'
import { BOT_STATUSES, cancelBot, scheduleBotForRecording } from '@auxx/lib/recording'
import { SettingsService } from '@auxx/lib/settings'
import { generateId } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const settingsService = new SettingsService()

export const recordingRouter = createTRPCRouter({
  /**
   * List recordings for the organization with optional filters.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(BOT_STATUSES).optional(),
        fromDate: z.date().optional(),
        toDate: z.date().optional(),
        calendarEventId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { status, fromDate, toDate, calendarEventId, cursor, limit } = input

      const conditions = [eq(schema.CallRecording.organizationId, organizationId)]

      if (status) {
        conditions.push(eq(schema.CallRecording.status, status))
      }
      if (fromDate) {
        conditions.push(gte(schema.CallRecording.createdAt, fromDate))
      }
      if (toDate) {
        conditions.push(lte(schema.CallRecording.createdAt, toDate))
      }
      if (calendarEventId) {
        conditions.push(eq(schema.CallRecording.calendarEventId, calendarEventId))
      }
      if (cursor) {
        conditions.push(lte(schema.CallRecording.createdAt, new Date(cursor)))
      }

      const recordings = await ctx.db
        .select()
        .from(schema.CallRecording)
        .where(and(...conditions))
        .orderBy(desc(schema.CallRecording.createdAt))
        .limit(limit + 1)

      const hasMore = recordings.length > limit
      const items = hasMore ? recordings.slice(0, limit) : recordings
      const nextCursor = hasMore ? items[items.length - 1]?.createdAt?.toISOString() : undefined

      // Join calendar event data for meeting titles
      const calendarEventIds = items
        .map((r) => r.calendarEventId)
        .filter((id): id is string => !!id)

      let calendarEvents: Record<string, typeof schema.CalendarEvent.$inferSelect> = {}
      if (calendarEventIds.length > 0) {
        const events = await ctx.db
          .select()
          .from(schema.CalendarEvent)
          .where(inArray(schema.CalendarEvent.id, calendarEventIds))

        calendarEvents = Object.fromEntries(events.map((e) => [e.id, e]))
      }

      return {
        items: items.map((recording) => ({
          ...recording,
          calendarEvent: recording.calendarEventId
            ? (calendarEvents[recording.calendarEventId] ?? null)
            : null,
        })),
        nextCursor,
      }
    }),

  /**
   * Get a single recording with related data.
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session

    const [recording] = await ctx.db
      .select()
      .from(schema.CallRecording)
      .where(
        and(
          eq(schema.CallRecording.id, input.id),
          eq(schema.CallRecording.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!recording) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
    }

    // Load calendar event if linked
    let calendarEvent = null
    if (recording.calendarEventId) {
      const [event] = await ctx.db
        .select()
        .from(schema.CalendarEvent)
        .where(eq(schema.CalendarEvent.id, recording.calendarEventId))
        .limit(1)
      calendarEvent = event ?? null
    }

    // Load participants if calendar event exists
    let participants: (typeof schema.MeetingParticipant.$inferSelect)[] = []
    if (recording.calendarEventId) {
      participants = await ctx.db
        .select()
        .from(schema.MeetingParticipant)
        .where(eq(schema.MeetingParticipant.calendarEventId, recording.calendarEventId))
    }

    return {
      ...recording,
      calendarEvent,
      participants,
    }
  }),

  /**
   * Manually schedule a recording bot for a calendar event.
   */
  schedule: protectedProcedure
    .input(
      z.object({
        calendarEventId: z.string(),
        botName: z.string().optional(),
        consentMessage: z.string().optional(),
        captureVideo: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Load the calendar event
      const [event] = await ctx.db
        .select()
        .from(schema.CalendarEvent)
        .where(
          and(
            eq(schema.CalendarEvent.id, input.calendarEventId),
            eq(schema.CalendarEvent.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!event) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendar event not found' })
      }

      if (!event.meetingUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Calendar event has no meeting URL',
        })
      }

      // Get org recording settings in a single query
      const recordingSettings = await settingsService.getAllOrganizationSettings({
        organizationId,
        scope: 'RECORDING',
      })

      const botName = input.botName ?? (recordingSettings['recording.defaultBotName'] as string)
      const consentMessage =
        input.consentMessage ?? (recordingSettings['recording.defaultConsentMessage'] as string)
      const captureVideo =
        input.captureVideo ?? (recordingSettings['recording.captureVideo'] as boolean)
      const botProvider = recordingSettings['recording.botProvider'] as string

      // Create the CallRecording row
      const recordingId = generateId()
      await ctx.db.insert(schema.CallRecording).values({
        id: recordingId,
        organizationId,
        meetingId: event.entityInstanceId!,
        calendarEventId: event.id,
        provider: botProvider as 'recall' | 'babl' | 'self_hosted',
        meetingPlatform:
          (event.meetingPlatform as 'google_meet' | 'teams' | 'zoom' | 'unknown') ?? 'unknown',
        status: 'created',
        botName,
        consentMessage,
        createdById: ctx.session.user.id,
        updatedAt: new Date(),
      })

      // Schedule the bot
      const result = await scheduleBotForRecording({
        recordingId,
        organizationId,
        meetingUrl: event.meetingUrl,
        meetingPlatform:
          (event.meetingPlatform as 'google_meet' | 'teams' | 'zoom' | 'unknown') ?? 'unknown',
        botName,
        consentMessage,
        captureVideo,
        joinAt: event.startTime,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to schedule recording bot',
          cause: result.error,
        })
      }

      return result.value
    }),

  /**
   * Cancel a scheduled or active recording.
   */
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await cancelBot({
        recordingId: input.id,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel recording',
          cause: result.error,
        })
      }
    }),

  /**
   * Get a presigned video URL for playback (15-min TTL).
   */
  getVideoSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const [recording] = await ctx.db
        .select()
        .from(schema.CallRecording)
        .where(
          and(
            eq(schema.CallRecording.id, input.id),
            eq(schema.CallRecording.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!recording) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
      }

      if (!recording.videoAssetId) {
        return { url: null, message: 'Video not yet available' }
      }

      const mediaAssetService = createMediaAssetService(organizationId)
      const downloadRef = await mediaAssetService.getDownloadRefForVersion(recording.videoAssetId, {
        disposition: 'inline',
      })

      return { url: downloadRef.type === 'url' ? downloadRef.url : null }
    }),

  /**
   * Delete a recording and its associated media files (admin only).
   */
  delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session

    const [recording] = await ctx.db
      .select()
      .from(schema.CallRecording)
      .where(
        and(
          eq(schema.CallRecording.id, input.id),
          eq(schema.CallRecording.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!recording) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
    }

    // Soft-delete media assets
    const assetIds = [
      recording.videoAssetId,
      recording.audioAssetId,
      recording.videoPreviewAssetId,
      recording.videoStoryboardAssetId,
    ].filter((id): id is string => !!id)

    if (assetIds.length > 0) {
      const mediaAssetService = createMediaAssetService(organizationId, ctx.session.user.id)
      for (const assetId of assetIds) {
        await mediaAssetService.delete(assetId)
      }
    }

    // Delete the recording
    await ctx.db.delete(schema.CallRecording).where(eq(schema.CallRecording.id, input.id))
  }),
})
