// apps/web/src/server/api/routers/availability.ts

import {
  addException,
  deleteException,
  getWeeklyHours,
  listExceptions,
  resolveAvailability,
  saveWeeklyHours,
  updateException,
} from '@auxx/lib/availability'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)')

const minute = z.number().int().min(0).max(1440)

const timeRangeSchema = z.object({ start: minute, end: minute })

/**
 * Input subject — NEVER carries `organizationId`; every procedure below injects it from
 * `ctx.session.organizationId` before building the server-side `AvailabilitySubject`.
 */
const subjectInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization') }),
  z.object({ type: z.literal('worker'), userId: z.string() }),
  z.object({ type: z.literal('widget'), widgetId: z.string() }),
])

const weeklyHoursSchema = z.object({
  timezone: z.string(),
  days: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      ranges: z.array(timeRangeSchema),
    })
  ),
})

function buildSubject(organizationId: string, input: z.infer<typeof subjectInputSchema>) {
  switch (input.type) {
    case 'organization':
      return { type: 'organization' as const, organizationId }
    case 'worker':
      return { type: 'worker' as const, organizationId, userId: input.userId }
    case 'widget':
      return { type: 'widget' as const, organizationId, widgetId: input.widgetId }
  }
}

export const availabilityRouter = createTRPCRouter({
  getWeeklyHours: protectedProcedure
    .input(z.object({ subject: subjectInputSchema }))
    .query(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return getWeeklyHours(subject)
    }),

  saveWeeklyHours: adminProcedure
    .input(z.object({ subject: subjectInputSchema, weekly: weeklyHoursSchema }))
    .mutation(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return saveWeeklyHours(subject, input.weekly)
    }),

  listExceptions: protectedProcedure
    .input(
      z.object({
        subject: subjectInputSchema,
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return listExceptions(subject, { from: input.from, to: input.to })
    }),

  addException: adminProcedure
    .input(
      z.object({
        subject: subjectInputSchema,
        dateFrom: isoDate,
        dateTo: isoDate.optional(),
        label: z.string().optional(),
        isAvailable: z.boolean(),
        ranges: z.array(timeRangeSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return addException(subject, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        label: input.label,
        isAvailable: input.isAvailable,
        ranges: input.ranges,
      })
    }),

  updateException: adminProcedure
    .input(
      z.object({
        subject: subjectInputSchema,
        ids: z.array(z.string()).min(1),
        dateFrom: isoDate,
        dateTo: isoDate.optional(),
        label: z.string().optional(),
        isAvailable: z.boolean(),
        ranges: z.array(timeRangeSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return updateException(subject, input.ids, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        label: input.label,
        isAvailable: input.isAvailable,
        ranges: input.ranges,
      })
    }),

  deleteException: adminProcedure
    .input(z.object({ subject: subjectInputSchema, ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return deleteException(subject, input.ids)
    }),

  resolve: protectedProcedure
    .input(z.object({ subject: subjectInputSchema, from: isoDate, to: isoDate }))
    .query(async ({ ctx, input }) => {
      const subject = buildSubject(ctx.session.organizationId, input.subject)
      return resolveAvailability(subject, { from: input.from, to: input.to })
    }),
})
