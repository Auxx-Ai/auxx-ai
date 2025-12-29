// src/server/api/routers/ticketSequence.ts

// import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { ticketNumbering } from '@auxx/lib/tickets'
import { TicketSequenceModel } from '@auxx/database/models'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

export const ticketSequenceRouter = createTRPCRouter({
  // Get the ticket sequence settings for an organization
  get: protectedProcedure
    // .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx }) => {
      // const { organizationId } = input
      const { organizationId } = ctx.session
      // Get the ticket sequence for the organization
      const model = new TicketSequenceModel(organizationId)
      const res = await model.findFirst()
      const ticketSequence = res.ok ? res.value : null

      return ticketSequence
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

      const {
        prefix,
        paddingLength,
        usePrefix,
        useDateInPrefix,
        dateFormat,
        separator,
        suffix,
        useSuffix,
      } = input

      // Update the ticket sequence settings
      const model = new TicketSequenceModel(organizationId)
      const existing = await model.findFirst()
      if (existing.ok && existing.value) {
        const updated = await model.update(existing.value.id, {
          ...(prefix !== undefined && ({ prefix } as any)),
          ...(paddingLength !== undefined && ({ paddingLength } as any)),
          ...(usePrefix !== undefined && ({ usePrefix } as any)),
          ...(useDateInPrefix !== undefined && ({ useDateInPrefix } as any)),
          ...(dateFormat !== undefined && ({ dateFormat } as any)),
          ...(separator !== undefined && ({ separator } as any)),
          ...(suffix !== undefined && ({ suffix } as any)),
          ...(useSuffix !== undefined && ({ useSuffix } as any)),
        })
        if (!updated.ok) throw updated.error
        return updated.value
      } else {
        const created = await model.create({
          currentNumber: 0,
          ...(prefix !== undefined && ({ prefix } as any)),
          ...(paddingLength !== undefined && ({ paddingLength } as any)),
          ...(usePrefix !== undefined && ({ usePrefix } as any)),
          ...(useDateInPrefix !== undefined && ({ useDateInPrefix } as any)),
          ...(dateFormat !== undefined && ({ dateFormat } as any)),
          ...(separator !== undefined && ({ separator } as any)),
          ...(suffix !== undefined && ({ suffix } as any)),
          ...(useSuffix !== undefined && ({ useSuffix } as any)),
        } as any)
        if (!created.ok) throw created.error
        return created.value
      }
    }),

  // Reset the ticket counter
  resetCounter: protectedProcedure
    .input(z.object({ resetTo: z.number().min(0).default(0) }))
    .mutation(async ({ ctx, input }) => {
      const { resetTo } = input
      const { organizationId } = ctx.session
      // Reset the counter
      const model = new TicketSequenceModel(organizationId)
      const existing = await model.findFirst()
      if (existing.ok && existing.value) {
        const updated = await model.update(existing.value.id, { currentNumber: resetTo as any })
        if (!updated.ok) throw updated.error
        return updated.value
      } else {
        const created = await model.create({ currentNumber: resetTo } as any)
        if (!created.ok) throw created.error
        return created.value
      }
    }),

  // Generate a new ticket number
  generateTicketNumber: protectedProcedure
    // .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx }) => {
      const { organizationId } = ctx.session
      // Generate next number via model
      return await ticketNumbering.create(organizationId)
    }),
})
