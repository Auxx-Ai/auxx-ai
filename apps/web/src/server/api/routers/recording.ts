// apps/web/src/server/api/routers/recording.ts

import {
  BOT_STATUSES,
  cancelBot,
  createMeeting,
  deleteRecording,
  getRecordingDetail,
  getRecordingVideoUrl,
  getTranscript,
  getUtterances,
  listRecordings,
  scheduleRecording,
  updateSpeakerParticipant,
} from '@auxx/lib/recording'
import { recordIdSchema } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

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
    .query(({ ctx, input }) => {
      return listRecordings({ ...input, organizationId: ctx.session.organizationId })
    }),

  /**
   * Get a single recording with related data.
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const detail = await getRecordingDetail(input.id, ctx.session.organizationId)
    if (!detail) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
    }
    return {
      ...detail.recording,
      calendarEvent: detail.calendarEvent,
      participants: detail.participants,
    }
  }),

  /**
   * Create a meeting — either via Google Meet (auto-creates calendar event) or manual URL.
   */
  createMeeting: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        startTime: z.string().datetime(),
        durationMinutes: z.number().int().min(1).max(480),
        timezone: z.string(),
        contactRecordIds: z.array(recordIdSchema).default([]),
        createGoogleMeet: z.boolean().default(false),
        meetingUrl: z.string().url().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createMeeting({
        ...input,
        startTime: new Date(input.startTime),
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return result.value
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
      const result = await scheduleRecording({
        ...input,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
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
    .query(({ ctx, input }) => {
      return getRecordingVideoUrl(input.id, ctx.session.organizationId)
    }),

  /**
   * Delete a recording and its associated media files (admin only).
   */
  delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await deleteRecording(input.id, ctx.session.organizationId, ctx.session.user.id)

    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
    }
  }),

  /**
   * Get transcript with speakers for a recording.
   */
  getTranscript: protectedProcedure
    .input(z.object({ recordingId: z.string() }))
    .query(({ ctx, input }) => {
      return getTranscript(input.recordingId, ctx.session.organizationId)
    }),

  /**
   * Get paginated utterances for a transcript, with speaker info.
   */
  getUtterances: protectedProcedure
    .input(
      z.object({
        transcriptId: z.string(),
        cursor: z.number().optional(),
        limit: z.number().min(1).max(200).default(100),
      })
    )
    .query(({ ctx, input }) => {
      return getUtterances({ ...input, organizationId: ctx.session.organizationId })
    }),

  /**
   * Manually assign a speaker to a participant (override auto-matching).
   */
  updateSpeaker: protectedProcedure
    .input(
      z.object({
        speakerId: z.string(),
        participantId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await updateSpeakerParticipant(
        input.speakerId,
        input.participantId,
        ctx.session.organizationId
      )

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Speaker not found' })
      }

      return updated
    }),
})
