// server/routers/user.ts

import {
  OrganizationMemberModel,
  TicketAssignmentModel,
  TicketModel,
  UserModel,
} from '@auxx/database/models'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const ticketAgentRouter = createTRPCRouter({
  // Get all agents for the current organization
  getAvailableAgents: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    // Ensure the user has access to this organization
    const om = new OrganizationMemberModel(organizationId)
    const res = await om.listWithUser({})
    const agents = res.ok ? res.value : []
    return agents?.map((agent: any) => ({ ...agent.user, role: agent.role }))
  }),

  addAgent: protectedProcedure
    .input(z.object({ ticketId: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { ticketId, agentId } = input
      try {
        // Check if the ticket exists
        const tModel = new TicketModel(ctx.session.organizationId)
        const tRes = await tModel.findById(ticketId)
        const ticket = tRes.ok ? tRes.value : null
        if (!ticket) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
        }
        // Check if the agent exists
        const uModel = new UserModel()
        const uRes = await uModel.findById(agentId)
        const agent = uRes.ok ? uRes.value : null
        if (!agent) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
        }
        // Create the assignment
        const taModel = new TicketAssignmentModel()
        const createRes = await taModel.create({
          ticketId: ticketId as any,
          agentId: agentId as any,
          isActive: true as any,
        } as any)
        if (createRes.ok) return createRes.value as any
        // If failed, try to activate existing
        const existing = await taModel.findByTicketAndAgent(ticketId, agentId)
        if (existing.ok && existing.value.length) {
          const ids = existing.value.map((e: any) => e.id)
          const upd = await taModel.updateMany(ids, {
            isActive: true as any,
            updatedAt: new Date(),
          } as any)
          if (!upd.ok) throw upd.error
          return { success: true }
        }
        throw createRes.error
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error
        }
        // Handle unique constraint violation
        // Unique constraint retry handled above with model path
        console.error('Error creating ticket assignment:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create ticket assignment',
        })
      }
    }),
  removeAgent: protectedProcedure
    .input(z.object({ ticketId: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { ticketId, agentId } = input
      try {
        // Simply mark the assignment as inactive instead of deleting it
        // This preserves assignment history
        const taModel = new TicketAssignmentModel()
        const existing = await taModel.findByTicketAndAgent(ticketId, agentId, { onlyActive: true })
        if (existing.ok && existing.value.length) {
          const ids = existing.value.map((e: any) => e.id)
          const upd = await taModel.updateMany(ids, {
            isActive: false,
            updatedAt: new Date(),
          } as any)
          if (!upd.ok) throw upd.error
        }
        return { success: true }
      } catch (error) {
        console.error('Error removing ticket assignment:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove ticket assignment',
        })
      }
    }),
})
