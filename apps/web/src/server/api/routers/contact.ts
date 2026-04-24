// ~/server/api/routers/contact.ts

import { ContactService } from '@auxx/lib/contacts'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const contactRouter = createTRPCRouter({
  // Get a single contact by ID
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { organizationId, userId } = ctx.session
      const contactService = new ContactService(organizationId, userId)

      const contact = await contactService.getContactById(input.id)

      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' })
      }

      return contact
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  // Mark a contact as spam
  markAsSpam: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.markContactAsSpam(input.id)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),
})
