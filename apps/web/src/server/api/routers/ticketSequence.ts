// src/server/api/routers/ticketSequence.ts

import { schema } from '@auxx/database'
import { ticketNumbering } from '@auxx/lib/tickets'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

export const ticketSequenceRouter = createTRPCRouter({
  // Get the ticket sequence settings for an organization
  get: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const [ticketSequence] = await ctx.db
      .select()
      .from(schema.TicketSequence)
      .where(eq(schema.TicketSequence.organizationId, organizationId))
      .limit(1)
    return ticketSequence ?? null
  }),

  // Update ticket sequence settings
  update: protectedProcedure
    .input(
      z.object({
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

      const setData: Record<string, unknown> = { updatedAt: new Date() }
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
        .from(schema.TicketSequence)
        .where(eq(schema.TicketSequence.organizationId, organizationId))
        .limit(1)

      if (existing) {
        const [updated] = await ctx.db
          .update(schema.TicketSequence)
          .set(setData)
          .where(eq(schema.TicketSequence.id, existing.id))
          .returning()
        return updated
      }

      const [created] = await ctx.db
        .insert(schema.TicketSequence)
        .values({
          organizationId,
          currentNumber: 0,
          ...setData,
        })
        .returning()
      return created
    }),

  // Reset the ticket counter
  resetCounter: protectedProcedure
    .input(z.object({ resetTo: z.number().min(0).default(0) }))
    .mutation(async ({ ctx, input }) => {
      const { resetTo } = input
      const { organizationId } = ctx.session

      const [existing] = await ctx.db
        .select()
        .from(schema.TicketSequence)
        .where(eq(schema.TicketSequence.organizationId, organizationId))
        .limit(1)

      if (existing) {
        const [updated] = await ctx.db
          .update(schema.TicketSequence)
          .set({ currentNumber: resetTo, updatedAt: new Date() })
          .where(eq(schema.TicketSequence.id, existing.id))
          .returning()
        return updated
      }

      const [created] = await ctx.db
        .insert(schema.TicketSequence)
        .values({
          organizationId,
          currentNumber: resetTo,
          updatedAt: new Date(),
        })
        .returning()
      return created
    }),

  // Generate a new ticket number
  generateTicketNumber: protectedProcedure.mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session
    return await ticketNumbering.create(organizationId)
  }),
})
