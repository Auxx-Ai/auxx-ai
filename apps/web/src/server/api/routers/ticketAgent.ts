// apps/web/src/server/api/routers/ticketAgent.ts

import { OrganizationMemberModel, UserModel } from '@auxx/database/models'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const ticketAgentRouter = createTRPCRouter({
  /**
   * Get all agents for the current organization
   */
  getAvailableAgents: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const om = new OrganizationMemberModel(organizationId)
    const res = await om.listWithUser({})
    const agents = res.ok ? res.value : []
    return agents?.map((agent: any) => ({ ...agent.user, role: agent.role }))
  }),

  /**
   * Add an agent assignment to a ticket.
   * Assignments are now an ACTOR field `assigned_to_id` on the ticket entity,
   * managed via UnifiedCrudHandler.
   */
  addAgent: protectedProcedure
    .input(z.object({ ticketId: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { ticketId, agentId } = input
      const { organizationId, userId } = ctx.session

      // Check if the agent exists
      const uModel = new UserModel()
      const uRes = await uModel.findById(agentId)
      const agent = uRes.ok ? uRes.value : null
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      // Update the assigned_to_id ACTOR field on the ticket via UnifiedCrudHandler
      const handler = new UnifiedCrudHandler(organizationId, userId)
      const recordId = toRecordId('ticket', ticketId)

      const existing = await handler.getById(recordId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
      }

      await handler.update(recordId, { assigned_to_id: agentId })

      return { success: true }
    }),

  /**
   * Remove an agent assignment from a ticket.
   * Clears the `assigned_to_id` ACTOR field via UnifiedCrudHandler.
   */
  removeAgent: protectedProcedure
    .input(z.object({ ticketId: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { ticketId } = input
      const { organizationId, userId } = ctx.session

      // Clear the assigned_to_id ACTOR field on the ticket
      const handler = new UnifiedCrudHandler(organizationId, userId)
      const recordId = toRecordId('ticket', ticketId)

      await handler.update(recordId, { assigned_to_id: null })

      return { success: true }
    }),
})
