// src/server/api/routers/ticketSequence.ts

import { schema } from '@auxx/database'
import { recordNumbering } from '@auxx/lib/records'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const scopeSchema = z
  .enum(['ticket', 'work_order', 'service_request', 'quote', 'invoice', 'order'])
  .default('ticket')

export const ticketSequenceRouter = createTRPCRouter({
  // Get the record sequence settings for an organization+scope
  get: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const scope = input?.scope ?? 'ticket'
      const [recordSequence] = await ctx.db
        .select()
        .from(schema.RecordSequence)
        .where(
          and(
            eq(schema.RecordSequence.organizationId, organizationId),
            eq(schema.RecordSequence.scope, scope)
          )
        )
        .limit(1)
      return recordSequence ?? null
    }),

  // Update record sequence settings
  update: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        prefix: z.string().optional(),
        paddingLength: z.number().min(1).max(10).optional(),
        usePrefix: z.boolean().optional(),
        useDateInPrefix: z.boolean().optional(),
        dateFormat: z.string().optional(),
        separator: z.string().optional(),
        suffix: z.string().optional(),
        useSuffix: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { scope } = input

      // Typed against the table's insert shape rather than
      // `Record<string, unknown>`, so each assignment below is checked and the
      // object stays usable in `.set()` / `.values()`. `updatedAt` is `notNull`
      // with no DB default, so it is supplied at each call site instead of here
      // — through a `Partial` it would read as optional and fail the insert.
      const setData: Partial<typeof schema.RecordSequence.$inferInsert> = {}
      if (input.prefix !== undefined) setData.prefix = input.prefix
      if (input.paddingLength !== undefined) setData.paddingLength = input.paddingLength
      if (input.usePrefix !== undefined) setData.usePrefix = input.usePrefix
      if (input.useDateInPrefix !== undefined) setData.useDateInPrefix = input.useDateInPrefix
      if (input.dateFormat !== undefined) setData.dateFormat = input.dateFormat
      if (input.separator !== undefined) setData.separator = input.separator
      if (input.suffix !== undefined) setData.suffix = input.suffix
      if (input.useSuffix !== undefined) setData.useSuffix = input.useSuffix

      const [existing] = await ctx.db
        .select()
        .from(schema.RecordSequence)
        .where(
          and(
            eq(schema.RecordSequence.organizationId, organizationId),
            eq(schema.RecordSequence.scope, scope)
          )
        )
        .limit(1)

      if (existing) {
        const [updated] = await ctx.db
          .update(schema.RecordSequence)
          .set({ ...setData, updatedAt: new Date() })
          .where(eq(schema.RecordSequence.id, existing.id))
          .returning()
        return updated
      }

      const [created] = await ctx.db
        .insert(schema.RecordSequence)
        .values({
          ...setData,
          organizationId,
          scope,
          currentNumber: 0,
          updatedAt: new Date(),
        })
        .returning()
      return created
    }),

  // Reset the record counter
  resetCounter: protectedProcedure
    .input(z.object({ scope: scopeSchema, resetTo: z.number().min(0).default(0) }))
    .mutation(async ({ ctx, input }) => {
      const { resetTo, scope } = input
      const { organizationId } = ctx.session

      const [existing] = await ctx.db
        .select()
        .from(schema.RecordSequence)
        .where(
          and(
            eq(schema.RecordSequence.organizationId, organizationId),
            eq(schema.RecordSequence.scope, scope)
          )
        )
        .limit(1)

      if (existing) {
        const [updated] = await ctx.db
          .update(schema.RecordSequence)
          .set({ currentNumber: resetTo, updatedAt: new Date() })
          .where(eq(schema.RecordSequence.id, existing.id))
          .returning()
        return updated
      }

      const [created] = await ctx.db
        .insert(schema.RecordSequence)
        .values({
          organizationId,
          scope,
          currentNumber: resetTo,
          updatedAt: new Date(),
        })
        .returning()
      return created
    }),

  // Generate a new record number
  generateTicketNumber: protectedProcedure
    .input(z.object({ scope: scopeSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      return await recordNumbering.create(organizationId, input.scope)
    }),
})
