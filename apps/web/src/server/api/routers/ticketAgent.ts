// apps/web/src/server/api/routers/ticketAgent.ts

import { listMembersWithUser } from '@auxx/lib/members'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { getUserById } from '@auxx/lib/users'
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
    const agents = await listMembersWithUser(organizationId)
    return agents.map((agent: any) => ({ ...agent.user, role: agent.role }))
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
      const agent = await getUserById(agentId)
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
