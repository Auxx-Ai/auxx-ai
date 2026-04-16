// apps/web/src/server/api/routers/recording.ts

import { database as db, schema } from '@auxx/database'
import type { AIPostProcessJobData, TranscribeRecordingJobData } from '@auxx/lib/jobs'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import {
  BOT_STATUSES,
  cancelBot,
  createInsightTemplate,
  createMeeting,
  deleteRecording,
  getInsightDetail,
  getRecordingDetail,
  getRecordingVideoUrl,
  getTranscript,
  getUtterances,
  listChapters,
  listInsights,
  listInsightTemplates,
  listRecordings,
  runInsightTemplate,
  scheduleRecording,
  updateSpeakerParticipant,
} from '@auxx/lib/recording'
import { recordIdSchema } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
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

  /** AI-generated chapters for a recording. */
  chapters: createTRPCRouter({
    list: protectedProcedure.input(z.object({ recordingId: z.string() })).query(({ ctx, input }) =>
      listChapters({
        db,
        organizationId: ctx.session.organizationId,
        callRecordingId: input.recordingId,
      })
    ),
  }),

  /** AI-generated insights per template. */
  insights: createTRPCRouter({
    list: protectedProcedure.input(z.object({ recordingId: z.string() })).query(({ ctx, input }) =>
      listInsights({
        db,
        organizationId: ctx.session.organizationId,
        callRecordingId: input.recordingId,
      })
    ),

    getById: protectedProcedure
      .input(z.object({ insightId: z.string() }))
      .query(async ({ ctx, input }) => {
        const result = await getInsightDetail({
          db,
          organizationId: ctx.session.organizationId,
          insightId: input.insightId,
        })
        if (result.isErr()) {
          throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
        }
        return result.value
      }),

    generate: protectedProcedure
      .input(z.object({ recordingId: z.string(), templateId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const organizationId = ctx.session.organizationId
        const userId = ctx.session.user.id

        // Block before creating a 'processing' row — otherwise the UI polls forever.
        const [transcript] = await db
          .select({ id: schema.Transcript.id, fullText: schema.Transcript.fullText })
          .from(schema.Transcript)
          .where(
            and(
              eq(schema.Transcript.callRecordingId, input.recordingId),
              eq(schema.Transcript.organizationId, organizationId)
            )
          )
          .limit(1)

        if (!transcript || !transcript.fullText) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Transcript not available yet — wait for processing to finish.',
          })
        }

        const insightId = generateId()

        // Create the row in 'processing' state up front so the UI can show it immediately.
        await db.insert(schema.RecordingInsight).values({
          id: insightId,
          organizationId,
          callRecordingId: input.recordingId,
          insightTemplateId: input.templateId,
          status: 'processing',
          updatedAt: new Date(),
        })

        // Fire-and-forget: runInsightTemplate handles its own error → sets status=failed.
        void runInsightTemplate({
          db,
          organizationId,
          callRecordingId: input.recordingId,
          templateId: input.templateId,
          userId,
          insightId,
        })

        return { insightId }
      }),
  }),

  /** Insight template management. */
  insightTemplates: createTRPCRouter({
    list: protectedProcedure
      .input(
        z.object({ status: z.enum(['enabled', 'disabled', 'archived']).optional() }).default({})
      )
      .query(({ ctx, input }) =>
        listInsightTemplates({
          db,
          organizationId: ctx.session.organizationId,
          status: input.status,
        })
      ),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          aiTitle: z.string().optional(),
          isDefault: z.boolean().optional(),
          sections: z
            .array(
              z.object({
                title: z.string().min(1),
                prompt: z.string().min(1),
                type: z.enum(['plaintext', 'list']),
              })
            )
            .min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        createInsightTemplate({
          db,
          organizationId: ctx.session.organizationId,
          userId: ctx.session.user.id,
          title: input.title,
          aiTitle: input.aiTitle,
          isDefault: input.isDefault,
          sections: input.sections,
        })
      ),
  }),

  /** Regenerate AI outputs (summary / chapters / insights / all). */
  regenerate: protectedProcedure
    .input(
      z.object({
        recordingId: z.string(),
        scope: z.enum(['all', 'summary', 'chapters', 'insights']).default('all'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId

      // Mark the recording as processing so the UI reflects pending state immediately.
      await db
        .update(schema.CallRecording)
        .set({ aiProcessingStatus: 'processing', aiProcessingError: null })
        .where(
          and(
            eq(schema.CallRecording.id, input.recordingId),
            eq(schema.CallRecording.organizationId, organizationId)
          )
        )

      const queue = getQueue(Queues.recordingProcessingQueue)
      const data: AIPostProcessJobData = {
        recordingId: input.recordingId,
        organizationId,
        trigger: 'manual',
        scope: input.scope,
        userId: ctx.session.user.id,
      }
      await queue.add('aiPostProcessJob', data, {
        jobId: `ai-post-process-${input.recordingId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      })

      return { ok: true }
    }),

  /** Regenerate transcript from the bot provider. Cascades into AI regeneration. */
  regenerateTranscript: protectedProcedure
    .input(z.object({ recordingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId

      const [recording] = await db
        .select()
        .from(schema.CallRecording)
        .where(
          and(
            eq(schema.CallRecording.id, input.recordingId),
            eq(schema.CallRecording.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!recording) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
      }
      if (!recording.externalBotId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Recording has no external bot ID — cannot refetch transcript',
        })
      }

      const queue = getQueue(Queues.recordingProcessingQueue)
      const data: TranscribeRecordingJobData = {
        recordingId: input.recordingId,
        organizationId,
      }
      await queue.add('transcribeRecordingJob', data, {
        jobId: `transcribe-${input.recordingId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      })

      return { ok: true }
    }),
})
